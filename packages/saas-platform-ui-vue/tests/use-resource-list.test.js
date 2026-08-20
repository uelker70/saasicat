// useResourceList — a page of a platform list, with no endpoint passed in.
//
// Two things are worth testing here and one is not. Worth testing: the
// pagination this composable owns, and the failures it refuses to let pass
// quietly — an operation that does not exist, and a filter that claims the two
// parameters the pagination sends. Not worth re-testing: the loading flag, the
// error, the reset on failure and the generation guard, which are
// `useAsyncData`'s and are covered there. What IS tested is that they are
// reached at all, because "delegates to useAsyncData" is a claim about
// behaviour, not about an import.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp, nextTick, ref } from 'vue';

import {
    AdminError,
    LIST_PAGE_SIZE_MAX,
    SUPER_ADMIN_RESOURCES_KEY,
    createResourceRegistry,
    platformResources,
    useResourceList,
} from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', projectKey: 'demo', locale: 'en' };

/** Records what went out and answers with `bodies`, one per call. */
function recorder(...bodies) {
    const calls = [];
    let answered = 0;
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        const body = bodies[Math.min(answered++, bodies.length - 1)] ?? [];
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
    };
    return { http, calls };
}

/**
 * Runs a composable where `inject` can see the registry.
 *
 * `app.runWithContext` rather than a mounted component: the composable reaches
 * the registry through the app-level provide, and nothing here renders.
 */
function inShell(http, run, resources = platformResources) {
    const app = createApp({});
    app.provide(
        SUPER_ADMIN_RESOURCES_KEY,
        createResourceRegistry({ http, context: CTX, resources }),
    );
    return app.runWithContext(run);
}

/**
 * Lets the `immediate` microtask, any watcher, and the request behind them run.
 *
 * A fixed number of ticks rather than two: the load is a chain of microtasks
 * (the deferred first load, the client, reading the body), and everything in it
 * is a resolved promise, so draining the queue settles it deterministically.
 */
async function settle() {
    for (let i = 0; i < 10; i++) {
        await nextTick();
        await Promise.resolve();
    }
}

const THREE_TENANTS = [{ id: '1' }, { id: '2' }, { id: '3' }];

describe('useResourceList — the first load', () => {
    test('asks the descriptor’s endpoint, which no caller had to supply', async () => {
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants'));
        await settle();
        assert.deepEqual(
            calls.map((c) => c.url),
            ['/api/v1/admin/tenants?page=1&pageSize=50'],
        );
        assert.deepEqual(list.items.value, THREE_TENANTS);
    });

    test('does not block setup — nothing has loaded synchronously', () => {
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants'));
        assert.equal(calls.length, 0);
        assert.deepEqual(list.items.value, []);
        assert.equal(list.pending.value, false);
    });

    test('immediate: false loads nothing until asked', async () => {
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants', { immediate: false }));
        await settle();
        assert.equal(calls.length, 0);
        await list.reload();
        assert.equal(calls.length, 1);
    });

    test('an opening page size is one request, not two', async () => {
        // The reason this option exists. A page that has a `pageSize` to apply
        // had to call `setPageSize` in setup — which loads — while the first
        // load was already queued, so every mount fetched the same rows twice.
        const { http, calls } = recorder(THREE_TENANTS);
        inShell(http, () => useResourceList('tenants', { pageSize: 25 }));
        await settle();
        assert.deepEqual(
            calls.map((c) => c.url),
            ['/api/v1/admin/tenants?page=1&pageSize=25'],
        );
    });

    test('an opening page size past the cap is capped, not sent', async () => {
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants', { pageSize: 5000 }));
        await settle();
        assert.equal(list.pageSize.value, LIST_PAGE_SIZE_MAX);
        assert.match(calls[0].url, new RegExp(`pageSize=${LIST_PAGE_SIZE_MAX}$`));
    });
});

describe('useResourceList — the pagination it owns', () => {
    test('goToPage moves the request and the ref', async () => {
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants', { immediate: false }));
        await list.goToPage(3);
        assert.equal(list.page.value, 3);
        assert.equal(calls.at(-1).url, '/api/v1/admin/tenants?page=3&pageSize=50');
    });

    test('setPageSize returns to the first page', async () => {
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants', { immediate: false }));
        await list.goToPage(4);
        await list.setPageSize(10);
        assert.equal(list.page.value, 1);
        assert.equal(calls.at(-1).url, '/api/v1/admin/tenants?page=1&pageSize=10');
    });

    test('a page off the scale is clamped before it is sent', async () => {
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants', { immediate: false }));
        await list.goToPage(0);
        assert.equal(calls.at(-1).url, '/api/v1/admin/tenants?page=1&pageSize=50');
    });

    test('a changed filter reloads from the first page', async () => {
        // Not from page 4: a narrower filter can leave fewer pages than the
        // operator is standing on, and the table would render nothing.
        const filter = ref({ status: 'active' });
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants', { filter, immediate: false }));
        await list.goToPage(4);
        filter.value = { status: 'suspended' };
        await settle();
        assert.equal(list.page.value, 1);
        assert.equal(calls.at(-1).url, '/api/v1/admin/tenants?page=1&pageSize=50&status=suspended');
    });

    test('a filter mutated in place is seen too', async () => {
        const filter = ref({ status: 'active' });
        const { http, calls } = recorder(THREE_TENANTS);
        inShell(http, () => useResourceList('tenants', { filter, immediate: false }));
        filter.value.status = 'deleted';
        await settle();
        assert.equal(calls.at(-1).url, '/api/v1/admin/tenants?page=1&pageSize=50&status=deleted');
    });
});

describe('useResourceList — what the rows and the count say', () => {
    test('a reported total is the total', async () => {
        const { http } = recorder({ items: [{ id: '1' }], total: 42, page: 1, pageSize: 50 });
        const list = inShell(http, () => useResourceList('tenants'));
        await settle();
        assert.equal(list.total.value, 42);
    });

    test('an unreported total falls back to the rows in hand', async () => {
        // Honest rather than zero: the paginator would otherwise offer no pages
        // for a list that plainly has rows on screen.
        const { http } = recorder({ items: [{ id: '1' }, { id: '2' }] });
        const list = inShell(http, () => useResourceList('tenants'));
        await settle();
        assert.equal(list.total.value, 2);
    });

    test('a bare array — what the tenants controller actually answers — is rows and count', async () => {
        const { http } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants'));
        await settle();
        assert.deepEqual(list.items.value, THREE_TENANTS);
        assert.equal(list.total.value, 3);
    });
});

describe('useResourceList — the state it delegates', () => {
    test('a failure arrives as an AdminError carrying the status', async () => {
        const http = () =>
            Promise.resolve({
                status: 403,
                headers: { get: () => null },
                json: async () => ({ code: 'FORBIDDEN', message: 'not yours' }),
                text: async () => '{}',
            });
        const list = inShell(http, () => useResourceList('tenants'));
        await settle();
        assert.ok(list.error.value instanceof AdminError);
        assert.equal(list.error.value.status, 403);
        assert.equal(list.error.value.code, 'FORBIDDEN');
        assert.equal(list.error.value.detail, 'not yours');
    });

    test('a failure empties the table rather than leaving stale rows under it', async () => {
        let fail = false;
        const http = () =>
            Promise.resolve({
                status: fail ? 500 : 200,
                headers: { get: () => null },
                json: async () => (fail ? {} : THREE_TENANTS),
                text: async () => '{}',
            });
        const list = inShell(http, () => useResourceList('tenants', { immediate: false }));
        await list.reload();
        assert.equal(list.items.value.length, 3);
        fail = true;
        await list.reload();
        assert.deepEqual(list.items.value, []);
        assert.equal(list.total.value, 0);
    });

    test('a superseded load does not overwrite the newer one', async () => {
        // `useApiList` has no such guard: two quick filter changes there land
        // the loser last. This asserts the delegation, not a reimplementation.
        const gates = [];
        const http = () => {
            let release;
            const promise = new Promise((resolve) => {
                release = resolve;
            });
            gates.push({ release });
            return promise;
        };
        const answer = (body) => ({
            status: 200,
            headers: { get: () => null },
            json: async () => body,
            text: async () => '{}',
        });
        const list = inShell(http, () => useResourceList('tenants', { immediate: false }));

        const first = list.reload();
        const second = list.reload();
        gates[1].release(answer([{ id: 'newer' }]));
        gates[0].release(answer([{ id: 'older' }]));
        await Promise.all([first, second]);

        assert.deepEqual(list.items.value, [{ id: 'newer' }]);
    });
});

describe('useResourceList — the page the server actually served', () => {
    test('a clamped page is adopted, so the next request asks for what is shown', async () => {
        // The operator asks for page 99 of a list that has two. The server
        // answers with page 2 and says so. Without adopting that, `reload`
        // asks for 99 again and the paginator reads "99 of 1" over the rows of
        // page 2 — `useApiList` has adopted the echo all along.
        const served = { items: [{ id: 'row-on-page-2' }], total: 40, page: 2, pageSize: 25 };
        const { http, calls } = recorder(served, served);
        await inShell(http, async () => {
            const list = useResourceList('tenants', { immediate: false });
            await list.goToPage(99);
            assert.equal(list.page.value, 2);
            assert.equal(list.pageSize.value, 25);
            await list.reload();
            assert.match(calls[1].url, /[?&]page=2&/);
            assert.match(calls[1].url, /pageSize=25/);
        });
    });

    test('an overdue answer moves neither the rows nor the paginator', async () => {
        // Two navigations overlap and the older one answers last. Its rows are
        // discarded by the generation check in `useAsyncData` — and its echo
        // has to be discarded with them, or the paginator names a page the
        // table is not showing and the next reload fetches it.
        const gates = [];
        const http = (url) => {
            let resolve;
            const promise = new Promise((r) => (resolve = r));
            gates.push({ url, resolve });
            return promise;
        };
        const answer = (page, id) => ({
            status: 200,
            headers: { get: () => null },
            json: async () => ({ items: [{ id }], total: 40, page, pageSize: 25 }),
            text: async () => '{}',
        });

        await inShell(http, async () => {
            const list = useResourceList('tenants', { immediate: false });
            const older = list.goToPage(3);
            const newer = list.goToPage(2);
            gates[1].resolve(answer(2, 'rows-of-page-2'));
            await newer;
            gates[0].resolve(answer(3, 'rows-of-page-3'));
            await older;
            assert.equal(list.items.value[0].id, 'rows-of-page-2');
            assert.equal(list.page.value, 2);
        });
    });

    test('an answer that says nothing about the page leaves the asked-for one', async () => {
        // A bare array, or an envelope without the echo, is not a statement
        // about which page was served. Overwriting the request state from a
        // silence would move the paginator on its own.
        const { http } = recorder([{ id: 'a' }], { items: [{ id: 'b' }], total: 9 });
        await inShell(http, async () => {
            const list = useResourceList('tenants', { immediate: false });
            await list.goToPage(3);
            assert.equal(list.page.value, 3);
            await list.reload();
            assert.equal(list.page.value, 3);
        });
    });
});

describe('useResourceList — the failures it refuses to swallow', () => {
    test('an operation the resource does not have fails by name, listing what there is', () => {
        const { http } = recorder();
        assert.throws(
            () => inShell(http, () => useResourceList('tenants', { op: 'lst' })),
            (err) => {
                assert.match(err.message, /useResourceList\("tenants", \{ op: "lst" \}\)/);
                assert.match(err.message, /has no such operation/);
                // What it offers is read off the descriptor, not written down
                // here: `tenantsResource` gained three operations when the
                // roster was completed, and a hardcoded list turns that into a
                // failing test about nothing while saying nothing about whether
                // the message is still useful.
                assert.match(
                    err.message,
                    new RegExp(
                        `It offers: ${Object.keys(platformResources.tenants.ops).join(', ')}\\.`,
                    ),
                );
                return true;
            },
        );
    });

    test('an operation named after an Object prototype key does not exist either', () => {
        // Indexing walks the prototype chain, so `toString` would have found
        // `Object.prototype`'s and called it — the registry documents the same
        // trap for overrides.
        const { http } = recorder();
        for (const name of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
            assert.throws(
                () => inShell(http, () => useResourceList('tenants', { op: name })),
                new RegExp(`op: "${name}".*has no such`, 's'),
                name,
            );
        }
    });

    test('no registry in scope says so, in the registry’s own words', () => {
        assert.throws(
            () => createApp({}).runWithContext(() => useResourceList('tenants')),
            /no resource registry in scope/,
        );
    });

    test('a filter that claims the pagination fails where it is written', () => {
        // `TenantListFilter` still declares `page` and `pageSize`, and a filter
        // carrying them wins on the wire while `page.value` keeps the number
        // `goToPage` set — two writers for one parameter, and the list would
        // report a page it is not showing.
        const { http } = recorder();
        assert.throws(
            () =>
                inShell(http, () =>
                    useResourceList('tenants', { filter: ref({ status: 'active', page: 7 }) }),
                ),
            (err) => {
                assert.match(err.message, /the filter carries page/);
                assert.match(err.message, /goToPage\(\)/);
                return true;
            },
        );
    });

    test('a filter that gains one later fails on the next load, without a word for the operator', async () => {
        const filter = ref({ status: 'active' });
        const { http } = recorder(THREE_TENANTS);
        const list = inShell(http, () => useResourceList('tenants', { filter, immediate: false }));
        filter.value = { status: 'active', pageSize: 5 };
        await settle();
        assert.ok(list.error.value instanceof AdminError);
        assert.match(list.error.value.message, /the filter carries pageSize/);
        // The sentence is a diagnostic. Leaving `detail` unset is what lets
        // `adminErrorMessage` answer with its translated wording instead.
        assert.equal(list.error.value.detail, undefined);
    });

    test('an empty or absent pagination key in the filter is not a claim', async () => {
        // `null` and `''` never reach the query string, so they collide with
        // nothing — refusing them would reject an ordinary cleared form field.
        const { http, calls } = recorder(THREE_TENANTS);
        const list = inShell(http, () =>
            useResourceList('tenants', { filter: ref({ page: null, pageSize: '' }) }),
        );
        await settle();
        assert.equal(list.error.value, null);
        assert.equal(calls[0].url, '/api/v1/admin/tenants?page=1&pageSize=50');
    });
});

describe('useResourceList — the audit list', () => {
    test('reaches its own endpoint with its own filter', async () => {
        const { http, calls } = recorder({ items: [{ id: 'a' }], total: 1 });
        const list = inShell(http, () =>
            useResourceList('audit', { filter: ref({ actorTag: 'cli:*', entity: 'Tenant' }) }),
        );
        await settle();
        assert.equal(
            calls[0].url,
            '/api/v1/admin/audit?page=1&pageSize=50&actorTag=cli%3A*&entity=Tenant',
        );
        assert.equal(list.total.value, 1);
    });
});

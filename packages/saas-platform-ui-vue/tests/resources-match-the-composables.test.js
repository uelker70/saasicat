// The descriptors request exactly what the composables request.
//
// `usePlans` and `usePlanVersions` had no test at all — and they own twelve of
// the package's endpoints. Rebuilding them on the descriptors is meant to
// change nothing, but "meant to" is not a check, and the suite that would have
// caught a changed URL did not exist.
//
// So rather than assert a hand-written list of expected URLs twice, this drives
// both implementations with the same arguments and compares what each one puts
// on the wire. It fails if they ever disagree — in either direction, whichever
// side moved.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { nextTick, ref } from 'vue';

import {
    auditResource,
    bindResource,
    planVersionsResource,
    plansResource,
    tenantsResource,
    useAuditEntries,
    usePlanVersions,
    usePlans,
    useTenants,
} from '../dist/index.js';

const ADMIN_ENDPOINT = '/api/v1/admin';
const PROJECT_KEY = 'demo app';
const PLAN_ID = 'plan-1';
const VERSION_ID = 'version-9';

/** Answers everything with a body rich enough that no operation bails early. */
function recorder() {
    const calls = [];
    const http = (url, init) => {
        calls.push({
            url,
            method: init?.method ?? 'GET',
            body: init?.body,
            headers: init?.headers,
        });
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            // Deliberately without `items`, `page` or `pageSize`: an echoing
            // answer would move the list's own refs, and the list cases below
            // read those refs to drive the descriptor.
            json: async () => ({ id: 'x', planVersion: { id: VERSION_ID }, warnings: [] }),
            text: async () => '{}',
        });
    };
    return { http, calls };
}

/** What the composable put on the wire for one call. */
async function viaComposable(build) {
    const { http, calls } = recorder();
    await build(http);
    return calls;
}

/** What the descriptor put on the wire for the same call. */
async function viaResource(def, op, args) {
    const { http, calls } = recorder();
    const ctx = { apiBase: ADMIN_ENDPOINT, projectKey: PROJECT_KEY, locale: 'en' };
    await bindResource(def, http, ctx)[op](...args);
    return calls;
}

function plansComposable(http) {
    return usePlans({
        adminEndpoint: ADMIN_ENDPOINT,
        projectKey: PROJECT_KEY,
        http,
        autoLoad: false,
    });
}

function versionsComposable(http) {
    return usePlanVersions({
        adminEndpoint: ADMIN_ENDPOINT,
        planId: PLAN_ID,
        http,
        autoLoad: false,
    });
}

/**
 * The request itself: where it went, how, and with what.
 *
 * Headers are left out, and not because they always match — the descriptors go
 * through `requestJson`, which sets a JSON content-type even on a GET, while
 * `useApiList` sets none. That one difference is pinned by its own test at the
 * bottom of this file rather than being swallowed here.
 */
function wire(calls) {
    return calls.map(({ url, method, body }) => ({ url, method, body }));
}

const PLAN_CASES = [
    { name: 'list', run: (c) => c.load(), op: 'list', args: [] },
    { name: 'tenantCounts', run: (c) => c.loadTenantCounts(), op: 'tenantCounts', args: [] },
    {
        // The composable makes the caller supply the project; the descriptor
        // takes it from the bound context. Same bytes on the wire — that is
        // the point of comparing here rather than asserting a URL twice.
        name: 'create',
        run: (c) => c.create({ planKey: 'pro', projectKey: PROJECT_KEY }),
        op: 'create',
        args: [{ planKey: 'pro' }],
    },
    {
        name: 'update',
        run: (c) => c.update(PLAN_ID, { name: 'Pro' }),
        op: 'update',
        args: [PLAN_ID, { name: 'Pro' }],
    },
    { name: 'softDelete', run: (c) => c.softDelete(PLAN_ID), op: 'softDelete', args: [PLAN_ID] },
    { name: 'hardDelete', run: (c) => c.hardDelete(PLAN_ID), op: 'hardDelete', args: [PLAN_ID] },
];

const VERSION_CASES = [
    { name: 'listForPlan', run: (c) => c.load(), op: 'listForPlan', args: [PLAN_ID] },
    {
        name: 'createDraft',
        run: (c) => c.createDraft({ version: 2 }),
        op: 'createDraft',
        args: [PLAN_ID, { version: 2 }],
    },
    {
        name: 'updateDraft',
        run: (c) => c.updateDraft(VERSION_ID, { price: 1 }),
        op: 'updateDraft',
        args: [VERSION_ID, { price: 1 }],
    },
    {
        name: 'publish',
        run: (c) => c.publish(VERSION_ID, { changeNote: 'note' }),
        op: 'publish',
        args: [VERSION_ID, { changeNote: 'note' }],
    },
    {
        name: 'discardDraft',
        run: (c) => c.discardDraft(VERSION_ID),
        op: 'discardDraft',
        args: [VERSION_ID],
    },
];

/** The only operation the two list descriptors declare. */
const LIST_OP = 'list';

const LIST_RESOURCES = [
    {
        name: 'tenantsResource / useTenants',
        def: tenantsResource,
        build: (http, filter) =>
            useTenants({ endpoint: `${ADMIN_ENDPOINT}/tenants`, filter, http, autoLoad: false }),
    },
    {
        name: 'auditResource / useAuditEntries',
        def: auditResource,
        build: (http, filter) =>
            useAuditEntries({ endpoint: `${ADMIN_ENDPOINT}/audit`, filter, http, autoLoad: false }),
    },
];

// Every value class the query-string rule decides about, in one filter. The
// three that are omitted and the falsy ones that are not are where a
// re-implementation diverges silently: `status=` filters every row away, and
// `page=0` is a page nobody asked for.
const EVERY_VALUE_CLASS = {
    str: 'active',
    empty: '',
    nul: null,
    undef: undefined,
    zero: 0,
    fals: false,
    encoded: 'a b&c=d',
    plus: 'a+b',
    filled: ['a', 'b'],
    emptyList: [],
};

const LIST_CASES = [
    { name: 'the first page, unfiltered', filter: {}, drive: (list) => list.reload() },
    {
        name: 'every value class in one filter',
        filter: EVERY_VALUE_CLASS,
        drive: (l) => l.reload(),
    },
    { name: 'a later page', filter: {}, drive: (list) => list.goToPage(3) },
    { name: 'a smaller page', filter: {}, drive: (list) => list.setPageSize(10) },
    { name: 'a page size past the cap', filter: {}, drive: (list) => list.setPageSize(500) },
    { name: 'a page below the first', filter: {}, drive: (list) => list.goToPage(0) },
    { name: 'a fractional page', filter: {}, drive: (list) => list.goToPage(2.7) },
    {
        // The filter is serialised after the pagination, so its `page` wins on
        // the wire while `list.page` keeps saying 3. `useResourceList` refuses
        // such a filter; the descriptor reproduces it, because reproducing what
        // goes out today is what this file measures.
        name: 'a filter that claims the pagination',
        filter: { page: 7, pageSize: 5 },
        drive: (list) => list.goToPage(3),
    },
    {
        name: 'a filter changed after paging away',
        filter: { status: 'active' },
        drive: async (list, filter) => {
            await list.goToPage(4);
            filter.value = { status: 'suspended' };
            // The filter watcher resets the page and reloads on the next tick.
            await nextTick();
        },
    },
];

/**
 * Drives the composable, and reports both what it sent and the state it ended
 * in — so the descriptor can be driven with that same state instead of with a
 * page number and a clamped size written down a second time.
 */
async function viaListComposable(resource, testCase) {
    const { http, calls } = recorder();
    const filter = ref({ ...testCase.filter });
    const list = resource.build(http, filter);
    await testCase.drive(list, filter);
    return {
        calls,
        query: { page: list.page.value, pageSize: list.pageSize.value, filter: filter.value },
    };
}

describe('the list descriptors match the list composables', () => {
    for (const resource of LIST_RESOURCES) {
        for (const testCase of LIST_CASES) {
            test(`${resource.name}: ${testCase.name}`, async () => {
                const { calls, query } = await viaListComposable(resource, testCase);
                const fromResource = await viaResource(resource.def, LIST_OP, [query]);
                // Only the last request: a case may page first and filter after,
                // and it is the request the composable ended on that the
                // descriptor is asked to reproduce.
                assert.deepEqual(wire(fromResource), wire(calls.slice(-1)));
            });
        }
    }

    test('every operation those resources declare is one these cases drive', () => {
        for (const resource of LIST_RESOURCES) {
            assert.deepEqual(
                Object.keys(resource.def.ops),
                [LIST_OP],
                `${resource.name} grew an operation this comparison does not drive`,
            );
        }
    });
});

describe('plansResource matches usePlans', () => {
    for (const testCase of PLAN_CASES) {
        test(`${testCase.name} sends the same request`, async () => {
            const fromComposable = await viaComposable((http) =>
                testCase.run(plansComposable(http)),
            );
            const fromResource = await viaResource(plansResource, testCase.op, testCase.args);
            assert.deepEqual(wire(fromResource), wire(fromComposable));
        });
    }
});

describe('planVersionsResource matches usePlanVersions', () => {
    for (const testCase of VERSION_CASES) {
        test(`${testCase.name} sends the same request`, async () => {
            const fromComposable = await viaComposable((http) =>
                testCase.run(versionsComposable(http)),
            );
            const fromResource = await viaResource(
                planVersionsResource,
                testCase.op,
                testCase.args,
            );
            assert.deepEqual(wire(fromResource), wire(fromComposable));
        });
    }
});

describe('the comparison itself', () => {
    test('covers every operation both sides declare', () => {
        // A case list that quietly stopped covering an operation would make
        // this whole file agree about less and less while staying green.
        assert.deepEqual(PLAN_CASES.map((c) => c.op).sort(), Object.keys(plansResource.ops).sort());
        const versionOps = Object.keys(planVersionsResource.ops).sort();
        const covered = VERSION_CASES.map((c) => c.op).sort();
        assert.deepEqual(
            versionOps.filter((op) => op !== 'terminate'),
            covered,
            'every plan-version operation except terminate, which the composable exposes ' +
                'under a different name and is compared separately',
        );
    });

    test('terminate matches too, under the composable’s own name', async () => {
        const fromComposable = await viaComposable((http) =>
            versionsComposable(http).terminateVersion(VERSION_ID, '2026-01-01'),
        );
        const fromResource = await viaResource(planVersionsResource, 'terminate', [
            VERSION_ID,
            '2026-01-01',
        ]);
        assert.deepEqual(wire(fromResource), wire(fromComposable));
    });

    test('the one header the two sides do not agree on', async () => {
        // `wire()` drops headers, so this is the difference it would otherwise
        // hide: the descriptors go through the resource layer's JSON policy,
        // which sets a content-type on every request including a GET with no
        // body, while `useApiList` sets none. Recorded rather than smoothed
        // over — a GET that declares a JSON body it does not have costs a CORS
        // preflight in a browser, and whichever way that is settled should be
        // settled deliberately.
        const { calls: fromComposable } = await viaListComposable(LIST_RESOURCES[0], {
            filter: {},
            drive: (list) => list.reload(),
        });
        const fromResource = await viaResource(tenantsResource, LIST_OP, []);

        assert.deepEqual(fromComposable[0].headers, {});
        assert.deepEqual(fromResource[0].headers, { 'content-type': 'application/json' });
    });
});

// The registry: what a page reaches, and what an app is allowed to change
// about it.
//
// The override cases are the point. A page built from props offers all of its
// behaviour or none of it — an app that needs one call diverted has to supply
// all twenty-four. The test that matters here is the one where a single
// operation is wrapped and every other one still comes from the platform.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    auditResource,
    createResourceRegistry,
    planVersionsResource,
    plansResource,
    platformResources,
    tenantsResource,
} from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', projectKey: 'demo', locale: 'en' };

function recordingHttp(body = []) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        return Promise.resolve({
            status: 200,
            headers: { get: () => null },
            json: async () => body,
            text: async () => '[]',
        });
    };
    return { http, calls };
}

function registryWith(http, overrides) {
    return createResourceRegistry({
        http,
        context: CTX,
        resources: { plans: plansResource, planVersions: planVersionsResource },
        overrides,
    });
}

describe('createResourceRegistry — the http requirement', () => {
    test('refuses to be built without a client, rather than reaching for fetch', () => {
        assert.throws(
            () => createResourceRegistry({ context: CTX, resources: platformResources }),
            /`http` is required/,
        );
    });

    test('the message names the two clients the package ships', () => {
        try {
            createResourceRegistry({ context: CTX, resources: platformResources });
            assert.fail('expected a throw');
        } catch (err) {
            assert.match(err.message, /createAxiosHttpClient/);
            assert.match(err.message, /createFetchHttpClient/);
        }
    });
});

describe('createResourceRegistry — the project a catalogue belongs to', () => {
    // An empty `projectKey` is the one misconfiguration nothing downstream
    // catches: `?projectKey=` is a valid request, and an admin API that filters
    // on it answers for no project at all — an empty catalogue that looks like
    // an empty catalogue. `usePlans` has refused it at construction from the
    // start; the registry path had lost the check.
    const NO_PROJECT = { apiBase: '/api/v1/admin', locale: 'en' };

    test('refuses to build a project-scoped resource without a project', () => {
        const { http } = recordingHttp();
        assert.throws(
            () =>
                createResourceRegistry({
                    http,
                    context: { ...CTX, projectKey: '' },
                    resources: platformResources,
                }),
            (err) => {
                assert.match(err.message, /Resource "plans" is project-scoped/);
                // The message has to name the option the app actually sets.
                assert.match(err.message, /endpoints\.projectKey/);
                assert.match(err.message, /context\.projectKey/);
                return true;
            },
        );
    });

    test('an absent key is the same mistake as an empty one, and so is a blank', () => {
        const { http } = recordingHttp();
        for (const context of [NO_PROJECT, { ...CTX, projectKey: '   ' }]) {
            assert.throws(
                () => createResourceRegistry({ http, context, resources: platformResources }),
                /is project-scoped/,
            );
        }
    });

    test('a context getter is asked once at boot, not left until the first click', () => {
        const { http } = recordingHttp();
        let asked = 0;
        assert.throws(
            () =>
                createResourceRegistry({
                    http,
                    context: () => {
                        asked += 1;
                        return NO_PROJECT;
                    },
                    resources: { plans: plansResource },
                }),
            /is project-scoped/,
        );
        assert.equal(asked, 1);
    });

    test('the resources that never send a project are built without one', () => {
        // The reason the check reads the descriptor instead of being made once
        // for the registry: an admin that lists tenants and reads the audit
        // trail administers no catalogue, and refusing it would be wrong.
        const { http } = recordingHttp();
        const registry = createResourceRegistry({
            http,
            context: NO_PROJECT,
            resources: {
                tenants: tenantsResource,
                audit: auditResource,
                planVersions: planVersionsResource,
            },
        });
        assert.deepEqual(registry.keys(), ['tenants', 'audit', 'planVersions']);
    });

    test('an app that names its project is unaffected', async () => {
        const { http, calls } = recordingHttp();
        const registry = createResourceRegistry({
            http,
            context: CTX,
            resources: platformResources,
        });
        await registry.get('plans').list();
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans?projectKey=demo');
    });

    test('a context override may be where the project comes from', async () => {
        // The check sees the context the operations will see, overrides merged
        // — so an app that scopes one resource elsewhere is not caught out.
        const { http, calls } = recordingHttp();
        const registry = createResourceRegistry({
            http,
            context: NO_PROJECT,
            resources: { plans: plansResource },
            overrides: { plans: { context: { projectKey: 'from-override' } } },
        });
        await registry.get('plans').list();
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans?projectKey=from-override');
    });
});

describe('createResourceRegistry — reaching a resource', () => {
    test('hands out the operations of the resource asked for', async () => {
        const { http, calls } = recordingHttp();
        await registryWith(http).get('plans').list();
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans?projectKey=demo');
    });

    test('an unknown key fails by name, listing what there is', () => {
        const { http } = recordingHttp();
        assert.throws(
            () => registryWith(http).get('nope'),
            (err) => {
                assert.match(err.message, /no such resource/);
                assert.match(err.message, /plans, planVersions/);
                return true;
            },
        );
    });

    test('keys() reports what it can answer for', () => {
        const { http } = recordingHttp();
        assert.deepEqual(registryWith(http).keys(), ['plans', 'planVersions']);
    });

    test('asking twice gives the same operations', () => {
        const { http } = recordingHttp();
        const registry = registryWith(http);
        assert.equal(registry.get('plans'), registry.get('plans'));
    });

    test('a context getter is read per call', async () => {
        const { http, calls } = recordingHttp();
        let projectKey = 'first';
        const registry = createResourceRegistry({
            http,
            context: () => ({ ...CTX, projectKey }),
            resources: { plans: plansResource },
        });
        await registry.get('plans').list();
        projectKey = 'second';
        await registry.get('plans').list();
        assert.match(calls[0].url, /projectKey=first$/);
        assert.match(calls[1].url, /projectKey=second$/);
    });
});

describe('createResourceRegistry — overrides', () => {
    test('a context override redirects one resource and leaves the others', async () => {
        const { http, calls } = recordingHttp();
        const registry = registryWith(http, {
            plans: { context: { apiBase: '/api/legacy/admin' } },
        });
        await registry.get('plans').list();
        await registry.get('planVersions').listForPlan('p1');
        assert.equal(calls[0].url, '/api/legacy/admin/catalog/plans?projectKey=demo');
        assert.equal(calls[1].url, '/api/v1/admin/catalog/plans/p1/versions');
    });

    test('an http override sends one resource through another client', async () => {
        const platform = recordingHttp();
        const special = recordingHttp();
        const registry = registryWith(platform.http, { plans: { http: special.http } });
        await registry.get('plans').list();
        await registry.get('planVersions').listForPlan('p1');
        assert.equal(special.calls.length, 1);
        assert.equal(platform.calls.length, 1);
    });

    test('one operation is wrapped and the other five stay the platform’s', async () => {
        const { http, calls } = recordingHttp({ id: 'v1' });
        const seen = [];
        const registry = registryWith(http, {
            planVersions: {
                ops: {
                    publish: async (next, versionId, options) => {
                        seen.push(versionId);
                        return next(versionId, { ...options, forceRegressive: false });
                    },
                },
            },
        });
        const ops = registry.get('planVersions');

        await ops.publish('v9', { allowZeroPrice: true });
        await ops.listForPlan('p1');

        // The wrapper ran, and what it passed on is what went out.
        assert.deepEqual(seen, ['v9']);
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plan-versions/v9/publish');
        assert.equal(
            calls[0].body,
            JSON.stringify({ allowZeroPrice: true, forceRegressive: false }),
        );
        // And the operation next to it was untouched.
        assert.equal(calls[1].url, '/api/v1/admin/catalog/plans/p1/versions');
    });

    test('the wrapper may answer without calling the platform at all', async () => {
        const { http, calls } = recordingHttp();
        const registry = registryWith(http, {
            plans: { ops: { list: async () => [{ id: 'from-cache' }] } },
        });
        assert.deepEqual(await registry.get('plans').list(), [{ id: 'from-cache' }]);
        assert.equal(calls.length, 0);
    });

    test('overriding a resource that does not exist fails at boot too', () => {
        // The sibling case below already failed loudly. This one did not: the
        // loop walks the resources, so an override keyed to a name that is not
        // there was read by nothing — the wrapper silently absent, the platform
        // operation still running.
        const { http } = recordingHttp();
        assert.throws(
            () => registryWith(http, { planVersion: { context: { apiBase: '/x' } } }),
            (err) => {
                assert.match(err.message, /no resource named "planVersion"/);
                assert.match(err.message, /The registry holds: plans, planVersions/);
                return true;
            },
        );
    });

    test('an override named after an Object prototype key is still rejected', () => {
        // `in` walks the prototype chain, so `constructor` passed validation
        // and was then skipped by the binding loop — silently ignored, which
        // is exactly what the validation exists to prevent.
        const { http } = recordingHttp();
        assert.throws(
            () => registryWith(http, { constructor: { context: { apiBase: '/x' } } }),
            /no resource named "constructor"/,
        );
    });

    test('an operation named after Object.prototype does not exist either', () => {
        // The sibling of the resource-key case above, and it was missed there:
        // indexing the bound resource walks the prototype chain, so `toString`
        // found `Object.prototype`'s and got wrapped. A typo failed loudly
        // while a prototype name passed silently — the outcome this check
        // exists to prevent.
        const { http } = recordingHttp();
        for (const name of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
            assert.throws(
                () => registryWith(http, { plans: { ops: { [name]: async (next) => next() } } }),
                (error) => error.message.includes(`has no operation "${name}"`),
                name,
            );
        }
    });

    test('overriding an operation that does not exist fails at boot, not at click', () => {
        const { http } = recordingHttp();
        assert.throws(
            () => registryWith(http, { plans: { ops: { pubish: async (next) => next() } } }),
            (err) => {
                assert.match(err.message, /has no operation "pubish"/);
                assert.match(err.message, /It offers: list, tenantCounts, create/);
                return true;
            },
        );
    });
});

describe('platformResources', () => {
    test('is what the shell registers, and every entry is a resource', () => {
        for (const [key, def] of Object.entries(platformResources)) {
            assert.equal(def.key, key, `${key} is registered under another name`);
            assert.ok(Object.keys(def.ops).length > 0, `${key} has no operations`);
        }
    });
});

// `bind` — one page instance overriding what the app already overrode.
//
// AP3 §3.2 gives every page a `resources` prop for the case where one instance
// reads from somewhere else. That has to LAYER over the app's own override
// rather than replace it: an app that records approvals around a publish keeps
// doing so when one page is pointed at a legacy host, and the page has no way
// to know the approval exists. So the chain is platform ← app ← instance, and
// the order is observable — each wrapper here appends to the same array.
describe('registry.bind — an override for one page instance', () => {
    test('the instance wrapper runs outside the app wrapper, and both run', async () => {
        const order = [];
        const { http } = recordingHttp();
        const registry = registryWith(http, {
            plans: {
                ops: {
                    list: async (next) => {
                        order.push('app');
                        return next();
                    },
                },
            },
        });

        const bound = registry.bind('plans', {
            ops: {
                list: async (next) => {
                    order.push('instance');
                    return next();
                },
            },
        });
        await bound.list();

        assert.deepEqual(order, ['instance', 'app']);
    });

    test('an instance context wins over the app context for that page only', async () => {
        const { http, calls } = recordingHttp();
        const registry = registryWith(http, {
            plans: { context: { apiBase: '/api/app/admin' } },
        });

        await registry.bind('plans', { context: { apiBase: '/api/legacy/admin' } }).list();
        await registry.get('plans').list();

        assert.match(calls[0].url, /^\/api\/legacy\/admin\//);
        assert.match(calls[1].url, /^\/api\/app\/admin\//, 'the shared binding is untouched');
    });

    test('binding one operation leaves the others on the platform implementation', async () => {
        const { http, calls } = recordingHttp();
        const registry = registryWith(http, undefined);

        const bound = registry.bind('plans', {
            ops: { list: async () => [{ id: 'from-the-override' }] },
        });

        assert.deepEqual(await bound.list(), [{ id: 'from-the-override' }]);
        assert.equal(calls.length, 0, 'the overridden op issued no request');

        await bound.create({ planKey: 'PRO' });
        assert.equal(calls.length, 1, 'the untouched op still reaches the platform');
        assert.equal(calls[0].method, 'POST');
    });

    test('an unknown resource says so instead of returning something inert', () => {
        const { http } = recordingHttp();
        assert.throws(() => registryWith(http, undefined).bind('nope', {}), /no such resource/);
    });
});

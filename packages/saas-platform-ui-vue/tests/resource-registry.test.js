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
    createResourceRegistry,
    planVersionsResource,
    plansResource,
    platformResources,
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

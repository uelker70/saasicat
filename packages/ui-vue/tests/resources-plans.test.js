// The plan catalogue descriptors, and the request policy under them.
//
// Every URL, method and body asserted here was read off the composable that
// owns the endpoint today (`usePlans` / `usePlanVersions` in
// `src/vue/use-plans.ts`). That is the point of the file: these descriptors are
// meant to be the same requests, so the test states what "the same" means
// before anything is rebuilt on top of them.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    AdminError,
    SA_MESSAGES,
    adminErrorMessage,
    bindResource,
    isTransportFailure,
    planVersionsResource,
    plansResource,
    requestJson,
    requestJsonBody,
} from '../dist/index.js';

const CTX = { apiBase: '/api/v1/admin', locale: 'en' };

/** Records every request and answers with what the test asked for. */
function recordingHttp({ status = 200, body = {}, unparseable = false } = {}) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, init });
        return Promise.resolve({
            status,
            headers: { get: () => null },
            json: async () => {
                if (unparseable) throw new SyntaxError('not json');
                return body;
            },
            text: async () => JSON.stringify(body),
        });
    };
    return { http, calls };
}

function bindPlans(httpStub) {
    return bindResource(plansResource, httpStub, CTX);
}

function bindVersions(httpStub) {
    return bindResource(planVersionsResource, httpStub, CTX);
}

describe('bindResource', () => {
    test('supplies http and context, leaving the operation its own arguments', async () => {
        const { http, calls } = recordingHttp({ body: [] });
        await bindPlans(http).list();
        assert.equal(calls.length, 1);
    });

    test('binds every operation the resource declares, and nothing else', () => {
        const { http } = recordingHttp();
        assert.deepEqual(Object.keys(bindPlans(http)).sort(), [
            'create',
            'hardDelete',
            'list',
            'softDelete',
            'tenantCounts',
            'update',
        ]);
    });

    test('reads a context getter per call, so a changed endpoint is picked up', async () => {
        const { http, calls } = recordingHttp({ body: [] });
        let apiBase = '/api/first/admin';
        const ops = bindResource(plansResource, http, () => ({ ...CTX, apiBase }));
        await ops.list();
        apiBase = '/api/second/admin';
        await ops.list();
        assert.equal(calls[0].url, '/api/first/admin/catalog/plans');
        assert.equal(calls[1].url, '/api/second/admin/catalog/plans');
    });
});

describe('plansResource', () => {
    test('list addresses the plan catalogue', async () => {
        const { http, calls } = recordingHttp({ body: [] });
        await bindPlans(http).list();
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans');
        assert.equal(calls[0].init.method, 'GET');
    });

    test('list turns an empty response into an empty list, not null', async () => {
        const { http } = recordingHttp({ status: 204 });
        assert.deepEqual(await bindPlans(http).list(), []);
    });

    test('tenantCounts has its own path and the same scoping', async () => {
        const { http, calls } = recordingHttp({ body: {} });
        await bindPlans(http).tenantCounts();
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans/tenant-counts');
    });

    test('tenantCounts turns an empty response into an empty map', async () => {
        const { http } = recordingHttp({ status: 204 });
        assert.deepEqual(await bindPlans(http).tenantCounts(), {});
    });

    test('create posts to the unscoped collection — the body carries the project', async () => {
        const { http, calls } = recordingHttp({ body: { id: 'p1' } });
        await bindPlans(http).create({ planKey: 'pro' });
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans');
        assert.equal(calls[0].init.method, 'POST');
        assert.equal(calls[0].init.body, JSON.stringify({ planKey: 'pro' }));
    });

    test('update patches the plan by id', async () => {
        const { http, calls } = recordingHttp({ body: { id: 'p1' } });
        await bindPlans(http).update('p1', { name: 'Pro' });
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans/p1');
        assert.equal(calls[0].init.method, 'PATCH');
    });

    test('softDelete and hardDelete are different endpoints', async () => {
        const { http, calls } = recordingHttp({ status: 204 });
        const ops = bindPlans(http);
        await ops.softDelete('p1');
        await ops.hardDelete('p1');
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans/p1');
        assert.equal(calls[0].init.method, 'DELETE');
        assert.equal(calls[1].url, '/api/v1/admin/catalog/plans/p1/purge');
        assert.equal(calls[1].init.method, 'DELETE');
    });

    test('a delete tolerates both an empty response and one with a body', async () => {
        for (const answer of [{ status: 204 }, { status: 200, body: { ok: true } }]) {
            const { http } = recordingHttp(answer);
            await bindPlans(http).softDelete('p1');
        }
    });
});

describe('planVersionsResource', () => {
    test('reading versions goes through the plan', async () => {
        const { http, calls } = recordingHttp({ body: [] });
        await bindVersions(http).listForPlan('p1');
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans/p1/versions');
    });

    test('creating a draft goes through the plan too', async () => {
        const { http, calls } = recordingHttp({ body: { planVersion: {}, warnings: [] } });
        await bindVersions(http).createDraft('p1', { version: 2 });
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plans/p1/versions');
        assert.equal(calls[0].init.method, 'POST');
    });

    test('but every mutation of an existing version addresses the version directly', async () => {
        const { http, calls } = recordingHttp({ body: { planVersion: {}, warnings: [] } });
        const ops = bindVersions(http);
        await ops.updateDraft('v9', { price: 1 });
        await ops.publish('v9', { changeNote: 'note' });
        await ops.terminate('v9', '2026-01-01');
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plan-versions/v9');
        assert.equal(calls[1].url, '/api/v1/admin/catalog/plan-versions/v9/publish');
        assert.equal(calls[2].url, '/api/v1/admin/catalog/plan-versions/v9/terminate');
    });

    test('discarding a draft deletes the version, not the plan', async () => {
        const { http, calls } = recordingHttp({ status: 204 });
        await bindVersions(http).discardDraft('v9');
        assert.equal(calls[0].url, '/api/v1/admin/catalog/plan-versions/v9');
        assert.equal(calls[0].init.method, 'DELETE');
    });

    test('listForPlan turns an empty response into an empty list', async () => {
        const { http } = recordingHttp({ status: 204 });
        assert.deepEqual(await bindVersions(http).listForPlan('p1'), []);
    });
});

describe('the shared request policy', () => {
    test('sends a JSON content type', async () => {
        const { http, calls } = recordingHttp({ body: [] });
        await bindPlans(http).list();
        assert.equal(calls[0].init.headers['content-type'], 'application/json');
    });

    test('a caller header wins over the default', async () => {
        const { http, calls } = recordingHttp({ body: {} });
        await requestJson(http, '/x', { headers: { 'content-type': 'text/plain' } });
        assert.equal(calls[0].init.headers['content-type'], 'text/plain');
    });

    test('serialises the body — the transport only carries strings', async () => {
        const { http, calls } = recordingHttp({ body: {} });
        await requestJson(http, '/x', { method: 'POST', body: { a: 1 } });
        assert.equal(calls[0].init.body, '{"a":1}');
    });

    test('sends no body when there is none, rather than the string "undefined"', async () => {
        const { http, calls } = recordingHttp({ body: {} });
        await requestJson(http, '/x', { method: 'DELETE' });
        assert.equal(calls[0].init.body, undefined);
    });

    test('a client that resolved with no status never reads as an answer', async () => {
        // `HttpClient` permits reporting a network, CORS or abort failure by
        // RESOLVING with `status: 0`, and an axios or XHR wrapper does exactly
        // that. Read as a 2xx it would hand a list `null` — an empty page with
        // nothing wrong on it — and tell a mutation's operator their change may
        // have been applied, for a request that never left the machine.
        const { http } = recordingHttp({ status: 0 });
        await assert.rejects(requestJson(http, '/x', { method: 'POST' }), (err) => {
            assert.ok(err instanceof AdminError);
            assert.equal(isTransportFailure(err), true);
            return true;
        });
    });

    test('a 204 and an unparsable 2xx both read as no body', async () => {
        const empty = recordingHttp({ status: 204 });
        assert.equal(await requestJson(empty.http, '/x'), null);
        const garbage = recordingHttp({ status: 200, unparseable: true });
        assert.equal(await requestJson(garbage.http, '/x'), null);
    });

    test('a non-2xx throws an AdminError carrying the parsed body and the code', async () => {
        const { http } = recordingHttp({
            status: 422,
            body: { code: 'PLAN_HAS_VERSIONS', message: 'still has versions' },
        });
        await assert.rejects(bindPlans(http).hardDelete('p1'), (err) => {
            assert.ok(err instanceof AdminError);
            assert.equal(err.status, 422);
            assert.equal(err.code, 'PLAN_HAS_VERSIONS');
            assert.deepEqual(err.body, {
                code: 'PLAN_HAS_VERSIONS',
                message: 'still has versions',
            });
            assert.equal(err.method, 'DELETE');
            assert.equal(err.url, '/api/v1/admin/catalog/plans/p1/purge');
            return true;
        });
    });

    test('what the server said survives — a page must not lose actionable text', async () => {
        // Third place this had to be read, and the second time it was read a
        // narrower way. Without it a page migrating onto the resources shows
        // "The entry changed in the meantime" where the server said exactly
        // what was wrong.
        const { http } = recordingHttp({
            status: 409,
            body: { code: 'PLAN_EXISTS', message: 'Plan already exists' },
        });
        await assert.rejects(bindPlans(http).create({ planKey: 'pro' }), (err) => {
            assert.equal(err.detail, 'Plan already exists');
            assert.equal(err.code, 'PLAN_EXISTS');
            return true;
        });
    });

    test('a validation array is joined here too, not only in the JSON helper', async () => {
        const { http } = recordingHttp({
            status: 400,
            body: { statusCode: 400, message: ['name is required', 'price must be positive'] },
        });
        await assert.rejects(bindPlans(http).create({}), (err) => {
            assert.equal(err.detail, 'name is required, price must be positive');
            return true;
        });
    });

    test('a non-2xx without a readable body still reports its status', async () => {
        const { http } = recordingHttp({ status: 502, unparseable: true });
        await assert.rejects(requestJson(http, '/x'), (err) => {
            assert.equal(err.status, 502);
            assert.equal(err.code, undefined);
            return true;
        });
    });

    test('a mutation that answers with nothing is a failure, not a null', async () => {
        const { http } = recordingHttp({ status: 204 });
        await assert.rejects(bindPlans(http).create({ planKey: 'pro' }), (err) => {
            assert.ok(err instanceof AdminError);
            // No HTTP status went wrong — the response was a 2xx.
            assert.equal(err.status, 0);
            assert.equal(err.emptyResponse, true);
            // A diagnostic, so it stays on `message` where the log reads it…
            assert.equal(err.message, 'Create returned no body');
            // …and the operator is told the change may already have landed.
            assert.equal(err.detail, undefined);
            assert.equal(
                adminErrorMessage(err, SA_MESSAGES.en.errors),
                SA_MESSAGES.en.errors.emptyResponse,
            );
            return true;
        });
    });

    test('each empty-body failure names the operation it came from', async () => {
        const cases = [
            [(ops) => ops.create({}), 'Create returned no body'],
            [(ops) => ops.update('p1', {}), 'Update returned no body'],
        ];
        for (const [call, expected] of cases) {
            const { http } = recordingHttp({ status: 204 });
            await assert.rejects(call(bindPlans(http)), (err) => {
                assert.equal(err.message, expected);
                assert.equal(err.emptyResponse, true);
                return true;
            });
        }
    });

    test('publish with no options sends an empty payload, not nothing', async () => {
        const { http, calls } = recordingHttp({ body: { planVersion: {}, warnings: [] } });
        await bindVersions(http).publish('v9');
        assert.equal(calls[0].init.body, '{}');
    });

    test('a request with no init at all defaults to GET', async () => {
        const { http, calls } = recordingHttp({ body: {} });
        await requestJson(http, '/x');
        assert.equal(calls[0].init.method, 'GET');
    });

    test('requestJsonBody names the default method when it has no init either', async () => {
        const { http } = recordingHttp({ status: 204 });
        await assert.rejects(requestJsonBody(http, '/x', 'nothing came back'), (err) => {
            assert.equal(err.status, 0);
            assert.equal(err.method, 'GET');
            assert.equal(err.message, 'nothing came back');
            assert.equal(err.emptyResponse, true);
            return true;
        });
    });

    test('a non-string code on the body is not treated as a code', async () => {
        const { http } = recordingHttp({ status: 400, body: { code: 42 } });
        await assert.rejects(requestJson(http, '/x'), (err) => {
            assert.equal(err.code, undefined);
            assert.deepEqual(err.body, { code: 42 });
            return true;
        });
    });

    test('a non-2xx whose body is not an object still carries what came back', async () => {
        const { http } = recordingHttp({ status: 503, body: 'unavailable' });
        await assert.rejects(requestJson(http, '/x'), (err) => {
            assert.equal(err.code, undefined);
            assert.equal(err.body, 'unavailable');
            return true;
        });
    });

    test('requestJsonBody passes a present body through untouched', async () => {
        const { http } = recordingHttp({ body: { id: 'p1' } });
        assert.deepEqual(await requestJsonBody(http, '/x', 'missing'), { id: 'p1' });
    });
});

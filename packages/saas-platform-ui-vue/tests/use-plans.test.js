// usePlans / usePlanVersions — the state each operation leaves behind.
//
// These two own twelve endpoints and had no test at all. The sibling file
// `resources-match-the-composables.test.js` pins what they put on the wire;
// this one pins what they do with the answer, which is the half a rebuild onto
// the resource descriptors could quietly change.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlansApiError, usePlanVersions, usePlans } from '../dist/index.js';

const ADMIN = '/api/v1/admin';

/** Answers each request in turn from `answers`, then repeats the last one. */
function scriptedHttp(answers) {
    const calls = [];
    let index = 0;
    const http = (url, init) => {
        calls.push({ url, init });
        const answer = answers[Math.min(index++, answers.length - 1)];
        return Promise.resolve({
            status: answer.status ?? 200,
            headers: { get: () => null },
            json: async () => {
                if (answer.unparseable) throw new SyntaxError('not json');
                return answer.body;
            },
            text: async () => JSON.stringify(answer.body ?? null),
        });
    };
    return { http, calls };
}

function plans(http, extra = {}) {
    return usePlans({ adminEndpoint: ADMIN, projectKey: 'demo', http, ...extra });
}

function versions(http, extra = {}) {
    return usePlanVersions({ adminEndpoint: ADMIN, planId: 'p1', http, ...extra });
}

describe('usePlans — construction', () => {
    test('refuses to run without an endpoint, because the platform cannot guess it', () => {
        assert.throws(() => usePlans({ projectKey: 'demo' }), /adminEndpoint. is required/);
    });

    test('refuses to run without a project key', () => {
        assert.throws(() => usePlans({ adminEndpoint: ADMIN }), /projectKey. is required/);
    });

    test('does not load until asked', async () => {
        const { http, calls } = scriptedHttp([{ body: [] }]);
        plans(http);
        await Promise.resolve();
        assert.equal(calls.length, 0);
    });

    test('autoLoad fires exactly one request', async () => {
        const { http, calls } = scriptedHttp([{ body: [] }]);
        plans(http, { autoLoad: true });
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(calls.length, 1);
    });
});

describe('usePlans — load', () => {
    test('fills the list and clears loading', async () => {
        const { http } = scriptedHttp([{ body: [{ id: 'p1' }, { id: 'p2' }] }]);
        const composable = plans(http);
        await composable.load();
        assert.equal(composable.plans.value.length, 2);
        assert.equal(composable.loading.value, false);
        assert.equal(composable.error.value, null);
    });

    test('an empty response is an empty list, not a failure', async () => {
        const { http } = scriptedHttp([{ status: 204 }]);
        const composable = plans(http);
        await composable.load();
        assert.deepEqual(composable.plans.value, []);
        assert.equal(composable.error.value, null);
    });

    test('a failure lands in error and does not escape', async () => {
        const { http } = scriptedHttp([{ status: 500, body: { message: 'boom' } }]);
        const composable = plans(http);
        await composable.load();
        assert.ok(composable.error.value instanceof PlansApiError);
        assert.equal(composable.error.value.status, 500);
        assert.equal(composable.loading.value, false);
    });

    test('tenantCounts failing is swallowed on purpose and leaves an empty map', async () => {
        const { http } = scriptedHttp([{ status: 500, body: {} }]);
        const composable = plans(http);
        await composable.loadTenantCounts();
        assert.deepEqual(composable.tenantCountsByPlanKey.value, {});
        // Deliberately untouched: a missing count is not a page-level error.
        assert.equal(composable.error.value, null);
    });
});

describe('usePlans — mutations keep the list in step', () => {
    test('create appends what came back', async () => {
        const { http } = scriptedHttp([{ body: [{ id: 'p1' }] }, { body: { id: 'p2' } }]);
        const composable = plans(http);
        await composable.load();
        const created = await composable.create({ planKey: 'pro' });
        assert.equal(created.id, 'p2');
        assert.deepEqual(
            composable.plans.value.map((p) => p.id),
            ['p1', 'p2'],
        );
    });

    test('update replaces in place, keeping the order', async () => {
        const { http } = scriptedHttp([
            { body: [{ id: 'p1', name: 'a' }, { id: 'p2' }] },
            { body: { id: 'p1', name: 'renamed' } },
        ]);
        const composable = plans(http);
        await composable.load();
        await composable.update('p1', { name: 'renamed' });
        assert.deepEqual(
            composable.plans.value.map((p) => p.id),
            ['p1', 'p2'],
        );
        assert.equal(composable.plans.value[0].name, 'renamed');
    });

    test('softDelete removes the row', async () => {
        const { http } = scriptedHttp([{ body: [{ id: 'p1' }, { id: 'p2' }] }, { status: 204 }]);
        const composable = plans(http);
        await composable.load();
        await composable.softDelete('p1');
        assert.deepEqual(
            composable.plans.value.map((p) => p.id),
            ['p2'],
        );
    });

    test('a rejected delete leaves the row where it was', async () => {
        const { http } = scriptedHttp([
            { body: [{ id: 'p1' }] },
            { status: 422, body: { code: 'PLAN_HAS_VERSIONS' } },
        ]);
        const composable = plans(http);
        await composable.load();
        await assert.rejects(composable.hardDelete('p1'), (err) => {
            assert.equal(err.status, 422);
            assert.equal(err.body.code, 'PLAN_HAS_VERSIONS');
            return true;
        });
        assert.equal(composable.plans.value.length, 1);
    });

    test('a create that answers with nothing is a failure, not a silent no-op', async () => {
        const { http } = scriptedHttp([{ status: 204 }]);
        await assert.rejects(plans(http).create({ planKey: 'pro' }), (err) => {
            assert.ok(err instanceof PlansApiError);
            assert.equal(err.status, 0);
            assert.match(err.message, /returned no body/);
            return true;
        });
    });
});

describe('usePlanVersions', () => {
    test('needs both an endpoint and a plan', () => {
        assert.throws(() => usePlanVersions({ planId: 'p1' }), /adminEndpoint. is required/);
        assert.throws(() => usePlanVersions({ adminEndpoint: ADMIN }), /planId. is required/);
    });

    test('load fills the versions', async () => {
        const { http } = scriptedHttp([{ body: [{ id: 'v1' }] }]);
        const composable = versions(http);
        await composable.load();
        assert.equal(composable.versions.value.length, 1);
    });

    test('createDraft appends the nested version, not the whole result', async () => {
        const { http } = scriptedHttp([
            { body: [] },
            { body: { planVersion: { id: 'v2' }, warnings: [] } },
        ]);
        const composable = versions(http);
        await composable.load();
        const result = await composable.createDraft({ version: 2 });
        assert.deepEqual(
            composable.versions.value.map((v) => v.id),
            ['v2'],
        );
        assert.deepEqual(result.warnings, []);
    });

    test('publish replaces the version in place', async () => {
        const { http } = scriptedHttp([
            { body: [{ id: 'v1', state: 'DRAFT' }] },
            { body: { planVersion: { id: 'v1', state: 'PUBLISHED' }, warnings: [] } },
        ]);
        const composable = versions(http);
        await composable.load();
        await composable.publish('v1', {});
        assert.equal(composable.versions.value[0].state, 'PUBLISHED');
    });

    test('discardDraft removes it', async () => {
        const { http } = scriptedHttp([{ body: [{ id: 'v1' }] }, { status: 204 }]);
        const composable = versions(http);
        await composable.load();
        await composable.discardDraft('v1');
        assert.deepEqual(composable.versions.value, []);
    });

    test('terminateVersion replaces the version with what came back', async () => {
        const { http } = scriptedHttp([
            { body: [{ id: 'v1', endsAt: null }] },
            { body: { id: 'v1', endsAt: '2026-01-01' } },
        ]);
        const composable = versions(http);
        await composable.load();
        await composable.terminateVersion('v1', '2026-01-01');
        assert.equal(composable.versions.value[0].endsAt, '2026-01-01');
    });

    test('its errors carry the API name they came from', async () => {
        const { http } = scriptedHttp([{ status: 503, body: {} }]);
        const composable = versions(http);
        await composable.load();
        assert.match(composable.error.value.message, /PlanVersions API/);
    });
});

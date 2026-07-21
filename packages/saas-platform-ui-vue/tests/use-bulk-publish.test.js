import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useBulkPublish } from '../dist/index.js';

const ENDPOINTS = {
    plan: (id) => `/api/v1/admin/plan-versions/${id}/publish`,
};

function buildHttp(responseFor) {
    const calls = [];
    const http = (url, init) => {
        calls.push({ url, init });
        const r = responseFor(url, init) ?? { status: 200, body: { ok: true } };
        return Promise.resolve({
            status: r.status,
            headers: { get: () => null },
            json: async () => r.body,
            text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
        });
    };
    return { http, calls };
}

describe('useBulkPublish.setItems', () => {
    test('sets items with default status pending', () => {
        const { http } = buildHttp(() => null);
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([
            { key: 'plan:p1', kind: 'plan', draftId: 'p1', label: 'STANDARD v3' },
            { key: 'plan:p2', kind: 'plan', draftId: 'p2', label: 'BASIC v2' },
        ]);
        assert.equal(bp.items.value.length, 2);
        for (const item of bp.items.value) {
            assert.equal(item.status, 'pending');
        }
    });
});

describe('useBulkPublish.run — parallel publishes', () => {
    test('all successful → success count = 3, done=true', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: { id: 'p' } }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([
            { key: 'p:1', kind: 'plan', draftId: '1', label: 'A' },
            { key: 'p:2', kind: 'plan', draftId: '2', label: 'B' },
            { key: 'p:3', kind: 'plan', draftId: '3', label: 'C' },
        ]);
        await bp.run({ changeNote: 'Bulk-Update Q3' });
        assert.equal(calls.length, 3);
        assert.equal(bp.successCount.value, 3);
        assert.equal(bp.failureCount.value, 0);
        assert.equal(bp.done.value, true);
        assert.equal(bp.progress.value, 1);
    });

    test('single error → success=2, failure=1, done=true', async () => {
        const { http } = buildHttp((url) => {
            if (url.includes('/2/')) return { status: 409, body: 'CONFLICT' };
            return { status: 200, body: { id: 'p' } };
        });
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([
            { key: 'p:1', kind: 'plan', draftId: '1', label: 'A' },
            { key: 'p:2', kind: 'plan', draftId: '2', label: 'B' },
            { key: 'p:3', kind: 'plan', draftId: '3', label: 'C' },
        ]);
        await bp.run({ changeNote: 'Update' });
        assert.equal(bp.successCount.value, 2);
        assert.equal(bp.failureCount.value, 1);
        const failed = bp.items.value.find((i) => i.draftId === '2');
        assert.equal(failed.status, 'failed');
        assert.match(failed.error, /HTTP 409/);
    });

    test('empty changeNote → all items failed', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([{ key: 'p:1', kind: 'plan', draftId: '1', label: 'A' }]);
        await bp.run({ changeNote: '   ' });
        assert.equal(calls.length, 0); // no HTTP call
        assert.equal(bp.failureCount.value, 1);
        assert.match(bp.items.value[0].error, /Pflicht/);
    });

    test('mfaCode sets X-Mfa-Code header', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([{ key: 'p:1', kind: 'plan', draftId: '1', label: 'A' }]);
        await bp.run({ changeNote: 'X', mfaCode: '482159' });
        assert.equal(calls[0].init.headers['X-Mfa-Code'], '482159');
    });

    test('auth token is sent along', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS, getAuthToken: () => 'jwt-x' });
        bp.setItems([{ key: 'p:1', kind: 'plan', draftId: '1', label: 'A' }]);
        await bp.run({ changeNote: 'X' });
        assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-x');
    });
});

describe('useBulkPublish — endpoint mapping', () => {
    test('endpoints are called per kind', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([
            { key: 'p:1', kind: 'plan', draftId: '1', label: 'A' },
            { key: 'p:2', kind: 'plan', draftId: '2', label: 'B' },
        ]);
        await bp.run({ changeNote: 'X' });
        assert.match(calls[0].url, /\/api\/v1\/admin\/plan-versions\/1\/publish/);
        assert.match(calls[1].url, /\/api\/v1\/admin\/plan-versions\/2\/publish/);
    });

    test('override endpoints configurable', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({
            http,
            endpoints: {
                plan: (id) => `/custom/${id}`,
            },
        });
        bp.setItems([{ key: 'p:1', kind: 'plan', draftId: '1', label: 'A' }]);
        await bp.run({ changeNote: 'X' });
        assert.equal(calls[0].url, '/custom/1');
    });
});

describe('useBulkPublish — progress', () => {
    test('progress=0 for empty set', () => {
        const { http } = buildHttp(() => null);
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        assert.equal(bp.progress.value, 0);
        assert.equal(bp.done.value, false);
    });

    test('progress=0 before run, =1 after run', async () => {
        const { http } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([
            { key: 'p:1', kind: 'plan', draftId: '1', label: 'A' },
            { key: 'p:2', kind: 'plan', draftId: '2', label: 'B' },
        ]);
        assert.equal(bp.progress.value, 0);
        await bp.run({ changeNote: 'X' });
        assert.equal(bp.progress.value, 1);
    });
});

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
    test('setzt Items mit Default-Status pending', () => {
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

describe('useBulkPublish.run — parallele Publishes', () => {
    test('alle erfolgreich → success-Count = 3, done=true', async () => {
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

    test('einzelner Fehler → success=2, failure=1, done=true', async () => {
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

    test('leere changeNote → alle Items failed', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([{ key: 'p:1', kind: 'plan', draftId: '1', label: 'A' }]);
        await bp.run({ changeNote: '   ' });
        assert.equal(calls.length, 0); // kein HTTP-Aufruf
        assert.equal(bp.failureCount.value, 1);
        assert.match(bp.items.value[0].error, /Pflicht/);
    });

    test('mfaCode setzt X-Mfa-Code-Header', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        bp.setItems([{ key: 'p:1', kind: 'plan', draftId: '1', label: 'A' }]);
        await bp.run({ changeNote: 'X', mfaCode: '482159' });
        assert.equal(calls[0].init.headers['X-Mfa-Code'], '482159');
    });

    test('Auth-Token wird mitgesendet', async () => {
        const { http, calls } = buildHttp(() => ({ status: 200, body: {} }));
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS, getAuthToken: () => 'jwt-x' });
        bp.setItems([{ key: 'p:1', kind: 'plan', draftId: '1', label: 'A' }]);
        await bp.run({ changeNote: 'X' });
        assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-x');
    });
});

describe('useBulkPublish — Endpoint-Mapping', () => {
    test('Endpoints werden je Kind aufgerufen', async () => {
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

    test('Override-Endpoints konfigurierbar', async () => {
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

describe('useBulkPublish — Progress', () => {
    test('progress=0 bei leerem Set', () => {
        const { http } = buildHttp(() => null);
        const bp = useBulkPublish({ http, endpoints: ENDPOINTS });
        assert.equal(bp.progress.value, 0);
        assert.equal(bp.done.value, false);
    });

    test('progress=0 vor Run, =1 nach Run', async () => {
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

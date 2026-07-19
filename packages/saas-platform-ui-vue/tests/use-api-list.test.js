import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';
import { useApiList } from '../dist/index.js';

function buildHttp(responses = []) {
    const calls = [];
    let i = 0;
    const http = (url, init) => {
        calls.push({ url, init });
        const r = responses[i++] ??
            responses[responses.length - 1] ?? { status: 200, body: { items: [] } };
        return Promise.resolve({
            status: r.status,
            headers: { get: () => null },
            json: async () => r.body,
            text: async () => JSON.stringify(r.body),
        });
    };
    return { http, calls };
}

describe('useApiList — autoLoad + reload', () => {
    test('autoLoad triggert ersten Request', async () => {
        const { http, calls } = buildHttp([
            {
                status: 200,
                body: { items: [{ id: 1 }, { id: 2 }], total: 2, page: 1, pageSize: 50 },
            },
        ]);
        const list = useApiList({ endpoint: '/api/x', http });
        // Microtask warten
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(calls.length, 1);
        assert.equal(list.items.value.length, 2);
        assert.equal(list.total.value, 2);
    });

    test('autoLoad=false skipt Initial-Load', async () => {
        const { http, calls } = buildHttp([{ status: 200, body: { items: [] } }]);
        useApiList({ endpoint: '/api/x', http, autoLoad: false });
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(calls.length, 0);
    });

    test('reload() macht zusätzlichen Request', async () => {
        const { http, calls } = buildHttp([
            { status: 200, body: { items: [], total: 0 } },
            { status: 200, body: { items: [{ id: 1 }], total: 1 } },
        ]);
        const list = useApiList({ endpoint: '/api/x', http, autoLoad: false });
        await list.reload();
        await list.reload();
        assert.equal(calls.length, 2);
        assert.equal(list.items.value.length, 1);
    });
});

describe('useApiList — Pagination', () => {
    test('goToPage(N) → Page-Param ändert sich', async () => {
        const { http, calls } = buildHttp([{ status: 200, body: { items: [] } }]);
        const list = useApiList({ endpoint: '/api/x', http, autoLoad: false });
        await list.goToPage(3);
        assert.match(calls[0].url, /page=3/);
        assert.equal(list.page.value, 3);
    });

    test('setPageSize(N) → springt auf Seite 1', async () => {
        const { http, calls } = buildHttp([{ status: 200, body: { items: [] } }]);
        const list = useApiList({ endpoint: '/api/x', http, autoLoad: false });
        list.page.value = 5;
        await list.setPageSize(100);
        assert.match(calls[0].url, /pageSize=100/);
        assert.match(calls[0].url, /page=1/);
        assert.equal(list.page.value, 1);
        assert.equal(list.pageSize.value, 100);
    });

    test('goToPage(0) → klemmt auf Seite 1', async () => {
        const { http } = buildHttp([{ status: 200, body: { items: [] } }]);
        const list = useApiList({ endpoint: '/api/x', http, autoLoad: false });
        await list.goToPage(0);
        assert.equal(list.page.value, 1);
    });
});

describe('useApiList — Filter', () => {
    test('Filter-Werte als Query-Params, leere Werte weglassen', async () => {
        const filter = ref({ status: 'active', search: '', empty: null });
        const { http, calls } = buildHttp([{ status: 200, body: { items: [] } }]);
        const list = useApiList({ endpoint: '/api/x', filter, http, autoLoad: false });
        await list.reload();
        assert.match(calls[0].url, /status=active/);
        assert.doesNotMatch(calls[0].url, /search=/);
        assert.doesNotMatch(calls[0].url, /empty=/);
    });

    test('endpoint mit Query-String → korrekter Separator', async () => {
        const { http, calls } = buildHttp([{ status: 200, body: { items: [] } }]);
        const list = useApiList({ endpoint: '/api/x?fixed=1', http, autoLoad: false });
        await list.reload();
        assert.match(calls[0].url, /^\/api\/x\?fixed=1&/);
    });
});

describe('useApiList — Auth + Error', () => {
    test('Auth-Token wird als Bearer-Header mitgesendet', async () => {
        const { http, calls } = buildHttp([{ status: 200, body: { items: [] } }]);
        const list = useApiList({
            endpoint: '/api/x',
            http,
            getAuthToken: () => 'jwt-abc',
            autoLoad: false,
        });
        await list.reload();
        assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-abc');
    });

    test('non-200 → error.value gesetzt, items.value leer', async () => {
        const { http } = buildHttp([{ status: 500, body: null }]);
        const list = useApiList({ endpoint: '/api/x', http, autoLoad: false });
        await list.reload();
        assert.notEqual(list.error.value, null);
        assert.equal(list.items.value.length, 0);
    });
});

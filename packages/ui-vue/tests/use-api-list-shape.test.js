// Test: useApiList accepts both a raw array and
// `{items, total, page, pageSize}` wrapper responses.
//
// Bug class this test guards against (2026-05-10):
// Some admin backends return a raw array `[{...}, …]`.
// The platform composable previously had `body.items ?? []` because it
// expected a wrapper object — the table stayed empty despite HTTP 200 +
// 3 tenants in the body.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTick } from 'vue';
import { useApiList } from '../dist/index.js';

function makeStubHttp(body, status = 200) {
    return async () => ({
        status,
        headers: { get: () => null },
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
}

async function flushAutoLoad() {
    // useApiList triggers autoLoad in a microtask; wait several ticks
    // until the fetch promise resolves and the ref is updated.
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        await nextTick();
    }
}

describe('useApiList response shape tolerance', () => {
    test('Raw array `[{...}, {...}]` is consumed as items[]+total (array shape)', async () => {
        const sample = [
            { id: '1', slug: 'demo', name: 'Demo' },
            { id: '2', slug: 'damla', name: 'Damla Auto' },
            { id: '3', slug: 'anil', name: 'Anil Ülker' },
        ];
        const list = useApiList({
            endpoint: '/api/admin/tenants',
            http: makeStubHttp(sample),
        });
        await flushAutoLoad();
        assert.equal(list.items.value.length, 3, 'Items taken from raw array');
        assert.equal(list.items.value[0].slug, 'demo');
        assert.equal(list.total.value, 3, 'Total = Array.length');
    });

    test('Wrapper object `{items, total, page, pageSize}` is supported the same way (wrapper shape)', async () => {
        const sample = {
            items: [{ id: '1', slug: 'verein-1' }],
            total: 7,
            page: 2,
            pageSize: 25,
        };
        const list = useApiList({
            endpoint: '/api/v1/admin/tenants',
            http: makeStubHttp(sample),
        });
        await flushAutoLoad();
        assert.equal(list.items.value.length, 1);
        assert.equal(list.total.value, 7);
        assert.equal(list.page.value, 2);
        assert.equal(list.pageSize.value, 25);
    });

    test('Empty array → items=[], total=0', async () => {
        const list = useApiList({
            endpoint: '/api/admin/tenants',
            http: makeStubHttp([]),
        });
        await flushAutoLoad();
        assert.deepEqual(list.items.value, []);
        assert.equal(list.total.value, 0);
    });

    test('null/undefined body → items=[], no crash', async () => {
        const list = useApiList({
            endpoint: '/api/admin/tenants',
            http: makeStubHttp(null),
        });
        await flushAutoLoad();
        assert.deepEqual(list.items.value, []);
        assert.equal(list.total.value, 0);
    });
});

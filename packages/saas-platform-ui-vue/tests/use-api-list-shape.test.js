// Test: useApiList akzeptiert sowohl roh-Array als auch
// `{items, total, page, pageSize}`-Wrapper-Responses.
//
// Bug-Klasse, die dieser Test abfängt (2026-05-10):
// AutohausPro-Admin-`/api/admin/tenants` liefert ein rohes Array `[{...}, …]`.
// Plattform-Composable hatte vorher `body.items ?? []`, weil es ein
// Wrapper-Objekt erwartete — die Tabelle blieb leer trotz HTTP 200 +
// 3 Tenants im Body.

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
    // useApiList triggert autoLoad in einem Microtask; mehrere ticks warten
    // bis die fetch-Promise resolved und der Ref aktualisiert ist.
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        await nextTick();
    }
}

describe('useApiList Response-Shape-Toleranz', () => {
    test('Roh-Array `[{...}, {...}]` wird als items[]+total konsumiert (AutohausPro-Shape)', async () => {
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
        assert.equal(list.items.value.length, 3, 'Items aus rohem Array übernommen');
        assert.equal(list.items.value[0].slug, 'demo');
        assert.equal(list.total.value, 3, 'Total = Array.length');
    });

    test('Wrapper-Object `{items, total, page, pageSize}` wird genauso unterstützt (vereinsfux-Shape)', async () => {
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

    test('Leeres Array → items=[], total=0', async () => {
        const list = useApiList({
            endpoint: '/api/admin/tenants',
            http: makeStubHttp([]),
        });
        await flushAutoLoad();
        assert.deepEqual(list.items.value, []);
        assert.equal(list.total.value, 0);
    });

    test('null/undefined Body → items=[], kein Crash', async () => {
        const list = useApiList({
            endpoint: '/api/admin/tenants',
            http: makeStubHttp(null),
        });
        await flushAutoLoad();
        assert.deepEqual(list.items.value, []);
        assert.equal(list.total.value, 0);
    });
});

// useTenantExport — the tenant's full export, downloaded from `GET
// /billing/export` and handed over under the name the server offers.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { useTenantExport } from '../dist/index.js';

const EXPORT_BYTES = new Uint8Array([123, 34, 110, 34, 58, 49, 125]);

/**
 * A client answering each path with its `[status, body, disposition]`; a
 * request nobody scripted is a 404. A body that is a `Uint8Array` is a file,
 * answered with its bytes and, where given, the name the server offers.
 */
function routedHttp(routes) {
    const calls = [];
    const client = async (url, init) => {
        calls.push({ url, method: init?.method, binary: init?.binary === true });
        const [status, body, disposition = null] = routes[url] ?? [404, {}];
        const file = body instanceof Uint8Array;
        const headers = {
            'content-type': file ? 'application/json; charset=utf-8' : 'application/json',
            'content-disposition': disposition,
        };
        return {
            status,
            headers: { get: (name) => headers[name.toLowerCase()] ?? null },
            json: async () => body,
            text: async () => JSON.stringify(body),
            bytes: async () => (file ? body : new TextEncoder().encode(JSON.stringify(body))),
        };
    };
    return { client, calls };
}

function exportOf(routes, options = {}) {
    const { client, calls } = routedHttp(routes);
    const saved = [];
    const tenantExport = useTenantExport({
        http: client,
        save: (file) => saved.push(file),
        ...options,
    });
    return { tenantExport, calls, saved };
}

describe("the tenant's export", () => {
    test('is downloaded once and saved as it arrived, under the name the server offers', async () => {
        const { tenantExport, calls, saved } = exportOf({
            '/billing/export': [200, EXPORT_BYTES, 'attachment; filename="northwind-export.json"'],
        });

        await tenantExport.download();

        assert.deepEqual(calls, [{ url: '/billing/export', method: 'GET', binary: true }]);
        assert.equal(saved.length, 1);
        assert.deepEqual([...saved[0].content], [...EXPORT_BYTES]);
        assert.equal(saved[0].fileName, 'northwind-export.json');
        assert.equal(saved[0].mediaType, 'application/json; charset=utf-8');
        assert.equal(tenantExport.downloading.value, false);
    });

    test('is asked for under the prefix the app gives', async () => {
        const { tenantExport, calls } = exportOf(
            { '/api/billing/export': [200, EXPORT_BYTES] },
            { apiPrefix: '/api/billing/' },
        );

        await tenantExport.download();

        assert.deepEqual(
            calls.map((call) => call.url),
            ['/api/billing/export'],
        );
    });

    test('offered under no name, is saved under a name of its own', async () => {
        const { tenantExport, saved } = exportOf({ '/billing/export': [200, EXPORT_BYTES] });

        await tenantExport.download();

        assert.equal(saved[0].fileName, 'export');
    });

    test('refused, reaches the caller with its code, saves nothing, and the download is over', async () => {
        const { tenantExport, saved } = exportOf({
            '/billing/export': [
                503,
                {
                    code: 'TENANT_EXPORT_FAILED',
                    message: 'The export of this account could not be produced just now.',
                },
            ],
        });

        await assert.rejects(tenantExport.download(), (err) => {
            assert.equal(err.body.code, 'TENANT_EXPORT_FAILED');
            return true;
        });

        assert.deepEqual(saved, []);
        assert.equal(tenantExport.downloading.value, false);
    });

    test('asked for again while it downloads, is downloaded once', async () => {
        const { client, calls } = routedHttp({ '/billing/export': [200, EXPORT_BYTES] });
        let release = () => {};
        const held = new Promise((resolve) => {
            release = resolve;
        });
        const saved = [];
        const tenantExport = useTenantExport({
            http: async (url, init) => {
                await held;
                return client(url, init);
            },
            save: (file) => saved.push(file),
        });

        const first = tenantExport.download();
        assert.equal(tenantExport.downloading.value, true);
        // Released before either is awaited: a second download that did go out
        // would otherwise wait for a release only this test gives.
        const second = tenantExport.download();
        release();
        await Promise.all([first, second]);

        assert.equal(calls.length, 1);
        assert.equal(saved.length, 1);
    });
});

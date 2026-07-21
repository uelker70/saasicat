// createPlatformLoaders — tests that the factory correctly builds
// `BootLoader` + `ManifestLoader` from a single `endpoints` constant,
// respecting both default derivation and explicit overrides.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { BootLoader, ManifestLoader, createPlatformLoaders } from '../dist/index.js';

function buildStorage() {
    const map = new Map();
    return {
        get: (k) => map.get(k) ?? null,
        set: (k, v) => map.set(k, v),
        remove: (k) => map.delete(k),
        _map: map,
    };
}

function buildHttp(responses) {
    const calls = [];
    let i = 0;
    const http = (url, init) => {
        calls.push({ url, init });
        const r = responses[i++] ?? responses[responses.length - 1];
        return Promise.resolve({
            status: r.status,
            headers: { get: (n) => r.headers?.[n.toLowerCase()] ?? null },
            json: async () => r.body,
            text: async () => JSON.stringify(r.body),
        });
    };
    return { http, calls };
}

describe('createPlatformLoaders', () => {
    test('returns BootLoader + ManifestLoader instances', () => {
        const { http } = buildHttp([{ status: 200, body: {} }]);
        const loaders = createPlatformLoaders({
            endpoints: { apiBase: '/api/admin' },
            http,
        });
        assert.ok(loaders.bootLoader instanceof BootLoader);
        assert.ok(loaders.manifestLoader instanceof ManifestLoader);
    });

    test('derives default endpoints from apiBase', async () => {
        const { http, calls } = buildHttp([
            { status: 200, body: { project: { key: 'cf', displayName: 'CF' } } },
            { status: 200, body: { schemaVersion: 1 }, headers: { etag: '"a"' } },
        ]);
        const loaders = createPlatformLoaders({
            endpoints: { apiBase: '/api/admin' },
            http,
            storage: buildStorage(),
        });
        await loaders.bootLoader.load();
        await loaders.manifestLoader.load();
        assert.equal(calls[0].url, '/api/admin/boot');
        assert.equal(calls[1].url, '/api/admin/manifest');
    });

    test('honors explicit endpoint overrides', async () => {
        const { http, calls } = buildHttp([
            { status: 200, body: { project: { key: 'ma', displayName: 'MA' } } },
            { status: 200, body: { schemaVersion: 1 }, headers: { etag: '"b"' } },
        ]);
        const loaders = createPlatformLoaders({
            endpoints: {
                apiBase: '/ignored',
                publicBootEndpoint: '/api/v1/admin/boot',
                manifestEndpoint: '/api/v1/admin/manifest',
            },
            http,
            storage: buildStorage(),
        });
        await loaders.bootLoader.load();
        await loaders.manifestLoader.load();
        assert.equal(calls[0].url, '/api/v1/admin/boot');
        assert.equal(calls[1].url, '/api/v1/admin/manifest');
    });

    test('passes storageKeyPrefix + getAuthToken through to ManifestLoader', async () => {
        const storage = buildStorage();
        const { http, calls } = buildHttp([
            { status: 200, body: { schemaVersion: 1 }, headers: { etag: '"v1"' } },
        ]);
        const loaders = createPlatformLoaders({
            endpoints: { apiBase: '/api/admin' },
            http,
            storage,
            storageKeyPrefix: 'ma:',
            getAuthToken: () => 'jwt-fake',
        });
        await loaders.manifestLoader.load();
        assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-fake');
        assert.equal(storage.get('ma:manifest:etag'), '"v1"');
    });
});

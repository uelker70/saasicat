import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ManifestLoadError, ManifestLoader } from '../dist/index.js';

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

const ENDPOINT = '/api/admin/manifest';

const SAMPLE_MANIFEST = {
    schemaVersion: 1,
    project: { key: 'demoapp', displayName: 'DemoApp' },
    build: {
        platformPackageVersion: '0.1.0',
        appVersion: '1.0.0',
        manifestHash: 'sha256-abc',
    },
    capabilities: {},
    navigation: { standardPages: {} },
    planCatalogSnapshot: {
        source: 'config/plans.yaml',
        hash: 'h1',
        currency: 'EUR',
        vatRate: 19,
        plans: [],
    },
};

describe('ManifestLoader.load — first call', () => {
    test('GET without If-None-Match, persists body + ETag', async () => {
        const storage = buildStorage();
        const { http, calls } = buildHttp([
            {
                status: 200,
                body: SAMPLE_MANIFEST,
                headers: { etag: '"sha256-abc"' },
            },
        ]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });
        const r = await loader.load();
        assert.equal(r.build.manifestHash, 'sha256-abc');
        assert.equal(calls[0].init.headers['If-None-Match'], undefined);
        assert.equal(storage.get('manifest:etag'), '"sha256-abc"');
    });

    test('auth token is sent as a Bearer header', async () => {
        const storage = buildStorage();
        const { http, calls } = buildHttp([
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"x"' } },
        ]);
        const loader = new ManifestLoader({
            http,
            storage,
            endpoint: ENDPOINT,
            getAuthToken: () => 'jwt-abc',
        });
        await loader.load();
        assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt-abc');
    });

    test('storageKeyPrefix isolates caches', async () => {
        const storage = buildStorage();
        const { http } = buildHttp([
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"x"' } },
        ]);
        const loader = new ManifestLoader({
            http,
            storage,
            endpoint: ENDPOINT,
            storageKeyPrefix: 'ma:',
        });
        await loader.load();
        assert.equal(storage.get('ma:manifest:etag'), '"x"');
        assert.equal(storage.get('manifest:etag'), null);
    });
});

describe('ManifestLoader.load — cache hit (304)', () => {
    test('sends If-None-Match + returns cached body on 304', async () => {
        const storage = buildStorage();
        // First call populates the cache
        const first = buildHttp([
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"sha256-abc"' } },
        ]);
        const loader1 = new ManifestLoader({ http: first.http, storage, endpoint: ENDPOINT });
        await loader1.load();

        // Second call gets a 304
        const second = buildHttp([{ status: 304, body: null }]);
        const loader2 = new ManifestLoader({ http: second.http, storage, endpoint: ENDPOINT });
        const r = await loader2.load();
        assert.equal(r.build.manifestHash, 'sha256-abc');
        assert.equal(second.calls[0].init.headers['If-None-Match'], '"sha256-abc"');
    });

    test('304 without cache → ManifestLoadError', async () => {
        const storage = buildStorage();
        // Cache is empty; server still responds with 304
        const { http } = buildHttp([{ status: 304, body: null }]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });
        await assert.rejects(
            loader.load(),
            (err) => err instanceof ManifestLoadError && err.status === 304,
        );
    });
});

describe('ManifestLoader.load — refresh (200 with new ETag)', () => {
    test('200 overwrites cache with new body + ETag', async () => {
        const storage = buildStorage();
        // First call
        const first = buildHttp([
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"v1"' } },
        ]);
        const loader1 = new ManifestLoader({ http: first.http, storage, endpoint: ENDPOINT });
        await loader1.load();
        assert.equal(storage.get('manifest:etag'), '"v1"');

        // Second call: server has a new version
        const newBody = {
            ...SAMPLE_MANIFEST,
            build: { ...SAMPLE_MANIFEST.build, manifestHash: 'sha256-new' },
        };
        const second = buildHttp([{ status: 200, body: newBody, headers: { etag: '"v2"' } }]);
        const loader2 = new ManifestLoader({ http: second.http, storage, endpoint: ENDPOINT });
        const r = await loader2.load();
        assert.equal(r.build.manifestHash, 'sha256-new');
        assert.equal(storage.get('manifest:etag'), '"v2"');
    });
});

describe('ManifestLoader.clearCache', () => {
    test('deletes body + ETag from storage', async () => {
        const storage = buildStorage();
        const { http } = buildHttp([
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"x"' } },
        ]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });
        await loader.load();
        assert.notEqual(storage.get('manifest:etag'), null);
        loader.clearCache();
        assert.equal(storage.get('manifest:etag'), null);
        assert.equal(storage.get('manifest:body'), null);
    });
});

describe('ManifestLoader.readCachedBody', () => {
    test('returns null on empty cache', () => {
        const storage = buildStorage();
        const { http } = buildHttp([]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });
        assert.equal(loader.readCachedBody(), null);
    });

    test('returns {etag, body} after a successful load', async () => {
        const storage = buildStorage();
        const { http } = buildHttp([
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"x"' } },
        ]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });
        await loader.load();
        const cached = loader.readCachedBody();
        assert.equal(cached.etag, '"x"');
        assert.equal(cached.body.build.manifestHash, 'sha256-abc');
    });
});

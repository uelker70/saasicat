import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ManifestLoadError, ManifestLoader } from '../dist/index.js';
import { authenticating } from './support/authenticating-client.mjs';

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

    test("the client's auth header reaches the request untouched", async () => {
        const storage = buildStorage();
        const { http, calls } = buildHttp([
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"x"' } },
        ]);
        const loader = new ManifestLoader({
            http: authenticating(http, 'jwt-abc'),
            storage,
            endpoint: ENDPOINT,
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

    test('a 304 whose cached body is gone is repaired, not reported', async () => {
        const storage = buildStorage();
        // The ETag outlived the body: a quota eviction, another tab clearing
        // one key, a half-written store. The conditional request that earned
        // this 304 is the loader's own, and so is the cache it asked against —
        // dropping the ETag and asking again is a step it can take itself.
        storage.set('manifest:etag', '"sha256-abc"');
        const { http, calls } = buildHttp([
            { status: 304, body: null },
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"sha256-def"' } },
        ]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });

        const manifest = await loader.load();

        assert.equal(manifest.build.manifestHash, 'sha256-abc');
        assert.equal(calls.length, 2);
        assert.equal(calls[0].init.headers['If-None-Match'], '"sha256-abc"');
        assert.equal(calls[1].init.headers['If-None-Match'], undefined);
        // Repaired, not merely survived: the next load is conditional again.
        assert.equal(storage.get('manifest:etag'), '"sha256-def"');
        assert.deepEqual(JSON.parse(storage.get('manifest:body')), SAMPLE_MANIFEST);
    });

    test('a cached body that no longer parses is repaired the same way', async () => {
        const storage = buildStorage();
        storage.set('manifest:etag', '"sha256-abc"');
        storage.set('manifest:body', '{"schemaVersion":1,"project"');
        const { http, calls } = buildHttp([
            { status: 304, body: null },
            { status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"sha256-def"' } },
        ]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });

        const manifest = await loader.load();

        assert.equal(manifest.build.manifestHash, 'sha256-abc');
        assert.equal(calls.length, 2);
        assert.deepEqual(JSON.parse(storage.get('manifest:body')), SAMPLE_MANIFEST);
    });

    test('a 304 to a request that carried no ETag is a server fault, and is reported', async () => {
        const storage = buildStorage();
        // Nothing was cached, so nothing conditional was asked. There is no
        // stale ETag to drop and repeating the same unconditional request
        // would only ask the same question twice.
        const { http, calls } = buildHttp([{ status: 304, body: null }]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });
        await assert.rejects(
            loader.load(),
            (err) => err instanceof ManifestLoadError && err.status === 304,
        );
        assert.equal(calls.length, 1);
    });

    test('a server answering 304 unconditionally is reported after one repair, not looped on', async () => {
        const storage = buildStorage();
        storage.set('manifest:etag', '"sha256-abc"');
        const { http, calls } = buildHttp([{ status: 304, body: null }]);
        const loader = new ManifestLoader({ http, storage, endpoint: ENDPOINT });
        await assert.rejects(
            loader.load(),
            (err) => err instanceof ManifestLoadError && err.status === 304,
        );
        assert.equal(calls.length, 2, 'one repair attempt, not a retry loop');
        // The stale pair is dropped either way, so the next load starts clean.
        assert.equal(storage.get('manifest:etag'), null);
        assert.equal(storage.get('manifest:body'), null);
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

describe('ManifestLoader — the client authenticates, per request', () => {
    // `platform-loaders.ts` builds the loader at MODULE SCOPE, i.e. long before
    // anyone has logged in. Every consumer does it that way, and the scaffolder
    // template generates it that way.
    //
    // The token used to be read by the loader. Since it is read by the client
    // the trap moved one layer down without getting smaller, and it produces
    // the nastiest possible failure shape either way: the admin works after a
    // page refresh (token already in storage at module load) and 401s right
    // after logging in (token acquired later) — which looks like a backend
    // problem and is not.
    //
    // What the loader still owes is the other half of it. It must reach the
    // client afresh for every request; a loader that built its headers once and
    // reused them would freeze whatever the client returned first, and no
    // amount of care on the client's side could then fix it.

    test('a token acquired after construction reaches the next request', async () => {
        let token = null; // not logged in yet
        const calls = [];
        const record = (url, init) => {
            calls.push(init);
            return Promise.resolve({
                status: 200,
                headers: { get: () => null },
                json: async () => SAMPLE_MANIFEST,
                text: async () => '',
            });
        };
        const loader = new ManifestLoader({
            endpoint: '/api/v1/admin/manifest',
            storage: buildStorage(),
            http: authenticating(record, () => token),
        });

        await loader.load();
        assert.equal(calls[0].headers.Authorization, undefined, 'anonymous first call');

        token = 'jwt-after-login'; // the user logs in — same loader instance
        await loader.load();

        assert.equal(
            calls[1].headers.Authorization,
            'Bearer jwt-after-login',
            'the second call must carry the token acquired after construction',
        );
    });

    test('a token that changes between requests is not cached', async () => {
        const tokens = ['first', 'refreshed'];
        const calls = [];
        const record = (url, init) => {
            calls.push(init);
            return Promise.resolve({
                status: 200,
                headers: { get: () => null },
                json: async () => SAMPLE_MANIFEST,
                text: async () => '',
            });
        };
        const loader = new ManifestLoader({
            endpoint: '/api/v1/admin/manifest',
            storage: buildStorage(),
            http: authenticating(record, () => tokens.shift() ?? null),
        });

        await loader.load();
        await loader.load();

        assert.equal(calls[0].headers.Authorization, 'Bearer first');
        assert.equal(calls[1].headers.Authorization, 'Bearer refreshed');
    });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { useManifest, usePublicBoot } from '../dist/index.js';

function buildHttp({ status = 200, body = {}, headers = {} } = {}) {
    return () =>
        Promise.resolve({
            status,
            headers: { get: (n) => headers[n.toLowerCase()] ?? null },
            json: async () => body,
            text: async () => JSON.stringify(body),
        });
}

function buildStorage() {
    const map = new Map();
    return {
        get: (k) => map.get(k) ?? null,
        set: (k, v) => map.set(k, v),
        remove: (k) => map.delete(k),
    };
}

describe('usePublicBoot', () => {
    test('initial state: boot=null, loading=false', () => {
        const { boot, loading, error } = usePublicBoot({
            endpoint: '/api/v1/admin/boot',
            http: buildHttp({ body: { project: {} } }),
        });
        assert.equal(boot.value, null);
        assert.equal(loading.value, false);
        assert.equal(error.value, null);
    });

    test('load() füllt boot.value', async () => {
        const { boot, load } = usePublicBoot({
            endpoint: '/api/v1/admin/boot',
            http: buildHttp({
                body: { project: { key: 'demoapp', displayName: 'DemoApp' } },
            }),
        });
        await load();
        assert.equal(boot.value.project.key, 'demoapp');
    });

    test('load() setzt error bei HTTP-Fehler', async () => {
        const { boot, error, load } = usePublicBoot({
            endpoint: '/api/v1/admin/boot',
            http: buildHttp({ status: 500 }),
        });
        await load();
        assert.equal(boot.value, null);
        assert.notEqual(error.value, null);
    });

    test('loading-State wechselt korrekt', async () => {
        let resolve;
        const http = () =>
            new Promise((r) => {
                resolve = r;
            });
        const { loading, load } = usePublicBoot({ http, endpoint: '/api/v1/admin/boot' });
        const p = load();
        // Mikrotask später ist loading=true
        await Promise.resolve();
        assert.equal(loading.value, true);
        resolve({
            status: 200,
            headers: { get: () => null },
            json: async () => ({ project: {} }),
            text: async () => '{}',
        });
        await p;
        assert.equal(loading.value, false);
    });
});

describe('useManifest', () => {
    test('initial state: manifest=null', () => {
        const storage = buildStorage();
        const { manifest } = useManifest({
            endpoint: '/api/v1/admin/manifest',
            http: buildHttp({ body: {} }),
            storage,
        });
        assert.equal(manifest.value, null);
    });

    test('load() füllt manifest', async () => {
        const storage = buildStorage();
        const { manifest, load } = useManifest({
            endpoint: '/api/v1/admin/manifest',
            http: buildHttp({
                status: 200,
                body: {
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
                        hash: 'h',
                        currency: 'EUR',
                        vatRate: 19,
                        plans: [],
                    },
                },
                headers: { etag: '"x"' },
            }),
            storage,
        });
        await load();
        assert.equal(manifest.value.build.manifestHash, 'sha256-abc');
    });

    test('reload() verwirft Cache + lädt frisch', async () => {
        const storage = buildStorage();
        let callCount = 0;
        const http = () => {
            callCount += 1;
            return Promise.resolve({
                status: 200,
                headers: { get: (n) => (n.toLowerCase() === 'etag' ? '"x"' : null) },
                json: async () => ({
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
                        hash: 'h',
                        currency: 'EUR',
                        vatRate: 19,
                        plans: [],
                    },
                }),
                text: async () => '{}',
            });
        };
        const { load, reload } = useManifest({ http, storage, endpoint: '/api/v1/admin/manifest' });
        await load();
        assert.equal(callCount, 1);
        await reload();
        assert.equal(callCount, 2);
        // Reload räumte den Cache → kein If-None-Match → keine 304-Mechanik
        // Wir verifizieren nur, dass ein zweiter HTTP-Call passiert.
    });

    test('clearCache() setzt manifest auf null', async () => {
        const storage = buildStorage();
        const { manifest, load, clearCache } = useManifest({
            endpoint: '/api/v1/admin/manifest',
            http: buildHttp({
                status: 200,
                body: {
                    schemaVersion: 1,
                    project: { key: 'cf', displayName: 'CF' },
                    build: {
                        platformPackageVersion: '0.1.0',
                        appVersion: '1.0.0',
                        manifestHash: 'sha256-abc',
                    },
                    capabilities: {},
                    navigation: { standardPages: {} },
                    planCatalogSnapshot: {
                        source: 'config/plans.yaml',
                        hash: 'h',
                        currency: 'EUR',
                        vatRate: 19,
                        plans: [],
                    },
                },
                headers: { etag: '"x"' },
            }),
            storage,
        });
        await load();
        assert.notEqual(manifest.value, null);
        clearCache();
        assert.equal(manifest.value, null);
    });
});

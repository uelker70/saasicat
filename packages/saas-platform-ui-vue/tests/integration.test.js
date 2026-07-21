// Integration tests: full boot → manifest → nav → action-registry flow.
//
// These tests simulate the consumer bootstrap with
// a scripted HTTP sequence:
//
//   1. Pre-login: GET /admin/boot → read branding.
//   2. Post-login: GET /admin/manifest → persist manifest with ETag.
//   3. App boot: buildRoutes/buildSidebar → reactive Vue composables.
//   4. Tenant action: ActionRegistry.dispatch → handler calls the server.
//   5. Bulk publish: useBulkPublish.run → parallel publishes.
//   6. Logout: clearCache → ETag disappears.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ActionRegistry,
    BootLoader,
    ManifestLoader,
    buildRoutes,
    buildSidebar,
    useBulkPublish,
} from '../dist/index.js';

const SAMPLE_MANIFEST = {
    schemaVersion: 1,
    project: { key: 'demoapp', displayName: 'DemoApp' },
    build: {
        platformPackageVersion: '0.1.0',
        appVersion: '1.0.0',
        manifestHash: 'sha256-abc123',
    },
    capabilities: {
        'tenants:list:read': true,
        'datev:export:run': true,
        'audit:list:read': true,
    },
    navigation: {
        standardPages: {
            tenants: { enabled: true, requiredCapability: 'tenants:list:read' },
            audit: { enabled: true, requiredCapability: 'audit:list:read' },
        },
        projectPages: [
            {
                id: 'cf.datev',
                label: 'DATEV',
                route: '/admin/datev',
                componentKey: 'cf-datev',
                requiredCapability: 'datev:export:run',
                navSection: 'DemoApp',
            },
        ],
    },
    dashboard: { kpiCards: [] },
    tenants: {
        columns: [],
        actions: [
            {
                id: 'cf.datev.runExport',
                label: 'DATEV-Export',
                actionKey: 'DATEV_EXPORT_RUN',
                requiredCapability: 'datev:export:run',
                requiresMfa: true,
                confirmType: 'simple',
            },
        ],
    },
    audit: { actions: [] },
    planCatalogSnapshot: {
        source: 'config/plans.yaml',
        hash: 'h',
        currency: 'EUR',
        vatRate: 19,
        plans: [],
    },
};

function buildScriptedHttp(script) {
    const calls = [];
    let i = 0;
    const http = (url, init) => {
        calls.push({ url, init });
        const handler = script[i++] ?? script[script.length - 1];
        const r = handler({ url, init });
        return Promise.resolve({
            status: r.status,
            headers: { get: (n) => r.headers?.[n.toLowerCase()] ?? null },
            json: async () => r.body,
            text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
        });
    };
    return { http, calls };
}

function buildStorage() {
    const map = new Map();
    return {
        get: (k) => map.get(k) ?? null,
        set: (k, v) => map.set(k, v),
        remove: (k) => map.delete(k),
        _map: map,
    };
}

describe('Full bootstrap flow: Boot → Manifest → Routes → Actions', () => {
    test('Consumer login bootstrap sequence', async () => {
        const storage = buildStorage();
        const { http, calls } = buildScriptedHttp([
            // 1. Pre-login: Boot
            () => ({
                status: 200,
                body: {
                    project: {
                        key: 'demoapp',
                        displayName: 'DemoApp',
                        environment: 'development',
                    },
                },
            }),
            // 2. Post-login: Manifest
            () => ({
                status: 200,
                body: SAMPLE_MANIFEST,
                headers: { etag: '"sha256-abc123"' },
            }),
        ]);

        // Step 1: Pre-login branding
        const bootLoader = new BootLoader({ http, endpoint: '/api/v1/admin/boot' });
        const boot = await bootLoader.load();
        assert.equal(boot.project.key, 'demoapp');
        assert.equal(boot.project.displayName, 'DemoApp');

        // Step 2: Login happens (externally), then manifest
        const manifestLoader = new ManifestLoader({
            http,
            storage,
            endpoint: '/api/v1/admin/manifest',
            getAuthToken: () => 'jwt-fake',
        });
        const manifest = await manifestLoader.load();
        assert.equal(manifest.build.manifestHash, 'sha256-abc123');
        // ETag was persisted
        assert.equal(storage.get('manifest:etag'), '"sha256-abc123"');

        // Step 3: Build routes + sidebar
        const routes = buildRoutes(manifest);
        assert.equal(routes.length, 3); // tenants, audit, datev
        assert.ok(routes.find((r) => r.id === 'tenants'));
        assert.ok(routes.find((r) => r.id === 'cf.datev'));

        const sidebar = buildSidebar(routes);
        // StandardPages inherit default sections (tenants→Kunden, audit→System);
        // the ProjectPages section "DemoApp" is appended alphabetically at the end.
        assert.equal(sidebar[0].section, 'Kunden');
        assert.equal(sidebar[0].items[0].id, 'tenants');
        assert.equal(sidebar[1].section, 'System');
        assert.equal(sidebar[1].items[0].id, 'audit');
        assert.equal(sidebar[2].section, 'DemoApp');
        assert.equal(sidebar[2].items.length, 1); // datev

        // Step 4: Action registry with handler
        let actionInput = null;
        const registry = new ActionRegistry(manifest, {
            DATEV_EXPORT_RUN: async (input) => {
                actionInput = input;
                return { ok: true, exportId: 'exp-1' };
            },
        });
        const action = registry.get('DATEV_EXPORT_RUN');
        assert.equal(action.def.requiresMfa, true); // UI must show the MFA modal

        const result = await registry.dispatch('DATEV_EXPORT_RUN', {
            tenantSlug: 'demo',
        });
        assert.deepEqual(result, { ok: true, exportId: 'exp-1' });
        assert.deepEqual(actionInput, { tenantSlug: 'demo' });

        // Verification: Boot + Manifest = 2 HTTP calls
        assert.equal(calls.length, 2);
    });

    test('Cache-hit path: second manifest load returns 304', async () => {
        const storage = buildStorage();
        // First load: persists the cache
        const { http: http1 } = buildScriptedHttp([
            () => ({
                status: 200,
                body: SAMPLE_MANIFEST,
                headers: { etag: '"v1"' },
            }),
        ]);
        const loader1 = new ManifestLoader({
            http: http1,
            storage,
            endpoint: '/api/v1/admin/manifest',
        });
        await loader1.load();

        // Second load: server returns 304, cache kicks in
        const { http: http2, calls: calls2 } = buildScriptedHttp([
            () => ({ status: 304, body: null }),
        ]);
        const loader2 = new ManifestLoader({
            http: http2,
            storage,
            endpoint: '/api/v1/admin/manifest',
        });
        const m = await loader2.load();
        assert.equal(m.build.manifestHash, 'sha256-abc123'); // from cache
        assert.equal(calls2[0].init.headers['If-None-Match'], '"v1"');
    });

    test('Logout path: clearCache clears everything', async () => {
        const storage = buildStorage();
        const { http } = buildScriptedHttp([
            () => ({ status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"v1"' } }),
        ]);
        const loader = new ManifestLoader({ http, storage, endpoint: '/api/v1/admin/manifest' });
        await loader.load();
        assert.notEqual(storage.get('manifest:etag'), null);
        assert.notEqual(storage.get('manifest:body'), null);
        loader.clearCache();
        assert.equal(storage.get('manifest:etag'), null);
        assert.equal(storage.get('manifest:body'), null);
    });

    test('Manifest reload after a `manifest reload` action invalidates the cache', async () => {
        const storage = buildStorage();
        const { http } = buildScriptedHttp([
            () => ({ status: 200, body: SAMPLE_MANIFEST, headers: { etag: '"v1"' } }),
            () => ({
                status: 200,
                body: {
                    ...SAMPLE_MANIFEST,
                    build: { ...SAMPLE_MANIFEST.build, manifestHash: 'sha256-v2' },
                },
                headers: { etag: '"v2"' },
            }),
        ]);
        const loader = new ManifestLoader({ http, storage, endpoint: '/api/v1/admin/manifest' });
        const first = await loader.load();
        assert.equal(first.build.manifestHash, 'sha256-abc123');

        // Consumer: after `<app> paket apply`, triggers manifest/reload
        loader.clearCache();
        const second = await loader.load();
        assert.equal(second.build.manifestHash, 'sha256-v2');
        assert.equal(storage.get('manifest:etag'), '"v2"');
    });
});

describe('Drift detection: manifest vs. consumer shell build', () => {
    test('Action drift detected: manifest action without a handler', () => {
        const registry = new ActionRegistry(SAMPLE_MANIFEST, {
            // DATEV_EXPORT_RUN is in the manifest, but no handler is registered
        });
        const orphaned = registry.listOrphanedDefs();
        assert.deepEqual(orphaned, ['DATEV_EXPORT_RUN']);
    });

    test('UI rejects routes with a missing capability', () => {
        const m = JSON.parse(JSON.stringify(SAMPLE_MANIFEST));
        m.capabilities['datev:export:run'] = false;
        const routes = buildRoutes(m);
        // tenants + audit yes, datev no (capability false)
        assert.equal(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
    });
});

describe('Bulk publish: end-to-end with server path', () => {
    test('Publish 3 drafts: 2 OK, 1 conflict — atomic progress', async () => {
        const { http } = buildScriptedHttp([
            ({ url }) => {
                if (url.includes('/draft-2/')) {
                    return { status: 409, body: 'Draft wurde bereits publiziert' };
                }
                return { status: 200, body: { id: 'p', publishedAt: new Date().toISOString() } };
            },
        ]);
        const bp = useBulkPublish({
            http,
            endpoints: {
                plan: (id) => `/api/v1/admin/plan-versions/${id}/publish`,
            },
            getAuthToken: () => 'jwt-fake',
        });
        bp.setItems([
            { key: 'p:draft-1', kind: 'plan', draftId: 'draft-1', label: 'STANDARD v3' },
            { key: 'p:draft-2', kind: 'plan', draftId: 'draft-2', label: 'BASIC v2' },
            { key: 'p:draft-3', kind: 'plan', draftId: 'draft-3', label: 'PRO v4' },
        ]);
        await bp.run({ changeNote: 'Q3 2026 Pricing Update', mfaCode: '482159' });
        assert.equal(bp.successCount.value, 2);
        assert.equal(bp.failureCount.value, 1);
        assert.equal(bp.done.value, true);
        assert.equal(bp.progress.value, 1);
        const failed = bp.items.value.find((i) => i.draftId === 'draft-2');
        assert.match(failed.error, /HTTP 409/);
    });
});

// Integration-Tests: full boot → manifest → nav → action-registry Flow.
//
// Diese Tests simulieren den Konsumenten-Bootstrap (AutohausPro/vereinsfux) mit
// einer scripted-HTTP-Sequence:
//
//   1. Pre-Login: GET /admin/boot → Branding lesen.
//   2. Post-Login: GET /admin/manifest → Manifest mit ETag persistieren.
//   3. App-Boot: buildRoutes/buildSidebar → reaktive Vue-Composables.
//   4. Tenant-Action: ActionRegistry.dispatch → handler ruft Server.
//   5. Bulk-Publish: useBulkPublish.run → parallele Publishes.
//   6. Logout: clearCache → ETag verschwindet.

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
    project: { key: 'autohauspro', displayName: 'AutohausPro' },
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
                componentKey: 'ahp-datev',
                requiredCapability: 'datev:export:run',
                navSection: 'AutohausPro',
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

describe('Full Bootstrap-Flow: Boot → Manifest → Routes → Actions', () => {
    test('Konsumenten-Login-Bootstrap-Sequenz', async () => {
        const storage = buildStorage();
        const { http, calls } = buildScriptedHttp([
            // 1. Pre-Login: Boot
            () => ({
                status: 200,
                body: {
                    project: {
                        key: 'autohauspro',
                        displayName: 'AutohausPro',
                        environment: 'development',
                    },
                },
            }),
            // 2. Post-Login: Manifest
            () => ({
                status: 200,
                body: SAMPLE_MANIFEST,
                headers: { etag: '"sha256-abc123"' },
            }),
        ]);

        // Schritt 1: Pre-Login Branding
        const bootLoader = new BootLoader({ http, endpoint: '/api/v1/admin/boot' });
        const boot = await bootLoader.load();
        assert.equal(boot.project.key, 'autohauspro');
        assert.equal(boot.project.displayName, 'AutohausPro');

        // Schritt 2: Login passiert (außerhalb), dann Manifest
        const manifestLoader = new ManifestLoader({
            http,
            storage,
            endpoint: '/api/v1/admin/manifest',
            getAuthToken: () => 'jwt-fake',
        });
        const manifest = await manifestLoader.load();
        assert.equal(manifest.build.manifestHash, 'sha256-abc123');
        // ETag wurde persistiert
        assert.equal(storage.get('manifest:etag'), '"sha256-abc123"');

        // Schritt 3: Routes + Sidebar bauen
        const routes = buildRoutes(manifest);
        assert.equal(routes.length, 3); // tenants, audit, datev
        assert.ok(routes.find((r) => r.id === 'tenants'));
        assert.ok(routes.find((r) => r.id === 'cf.datev'));

        const sidebar = buildSidebar(routes);
        // StandardPages erben Default-Sections (tenants→Kunden, audit→System);
        // ProjectPages-Section "AutohausPro" hängt alphabetisch hinten dran.
        assert.equal(sidebar[0].section, 'Kunden');
        assert.equal(sidebar[0].items[0].id, 'tenants');
        assert.equal(sidebar[1].section, 'System');
        assert.equal(sidebar[1].items[0].id, 'audit');
        assert.equal(sidebar[2].section, 'AutohausPro');
        assert.equal(sidebar[2].items.length, 1); // datev

        // Schritt 4: Action-Registry mit Handler
        let actionInput = null;
        const registry = new ActionRegistry(manifest, {
            DATEV_EXPORT_RUN: async (input) => {
                actionInput = input;
                return { ok: true, exportId: 'exp-1' };
            },
        });
        const action = registry.get('DATEV_EXPORT_RUN');
        assert.equal(action.def.requiresMfa, true); // UI muss MFA-Modal zeigen

        const result = await registry.dispatch('DATEV_EXPORT_RUN', {
            tenantSlug: 'demo',
        });
        assert.deepEqual(result, { ok: true, exportId: 'exp-1' });
        assert.deepEqual(actionInput, { tenantSlug: 'demo' });

        // Verifikation: Boot + Manifest = 2 HTTP-Calls
        assert.equal(calls.length, 2);
    });

    test('Cache-Hit-Pfad: zweiter Manifest-Load liefert 304', async () => {
        const storage = buildStorage();
        // Erst-Load: persistiert Cache
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

        // Zweit-Load: Server liefert 304, Cache greift
        const { http: http2, calls: calls2 } = buildScriptedHttp([
            () => ({ status: 304, body: null }),
        ]);
        const loader2 = new ManifestLoader({
            http: http2,
            storage,
            endpoint: '/api/v1/admin/manifest',
        });
        const m = await loader2.load();
        assert.equal(m.build.manifestHash, 'sha256-abc123'); // aus Cache
        assert.equal(calls2[0].init.headers['If-None-Match'], '"v1"');
    });

    test('Logout-Pfad: clearCache räumt komplett', async () => {
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

    test('Manifest-Reload nach `manifest reload`-Action invalidiert Cache', async () => {
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

        // Konsument: nach `ahp paket apply` triggert manifest/reload
        loader.clearCache();
        const second = await loader.load();
        assert.equal(second.build.manifestHash, 'sha256-v2');
        assert.equal(storage.get('manifest:etag'), '"v2"');
    });
});

describe('Drift-Detection: Manifest vs. Konsumenten-Shell-Build', () => {
    test('Action-Drift erkannt: Manifest-Action ohne Handler', () => {
        const registry = new ActionRegistry(SAMPLE_MANIFEST, {
            // DATEV_EXPORT_RUN ist im Manifest, aber kein Handler registriert
        });
        const orphaned = registry.listOrphanedDefs();
        assert.deepEqual(orphaned, ['DATEV_EXPORT_RUN']);
    });

    test('UI lehnt Capability-fehlende Routes ab', () => {
        const m = JSON.parse(JSON.stringify(SAMPLE_MANIFEST));
        m.capabilities['datev:export:run'] = false;
        const routes = buildRoutes(m);
        // tenants + audit ja, datev nicht (Capability false)
        assert.equal(
            routes.find((r) => r.id === 'cf.datev'),
            undefined,
        );
    });
});

describe('Bulk-Publish: end-to-end mit Server-Pfad', () => {
    test('3 Drafts publizieren: 2 OK, 1 Konflikt — atomarer Fortschritt', async () => {
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

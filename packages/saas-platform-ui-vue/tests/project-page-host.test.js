// ProjectPageHost — Unit-Tests, die ohne echten DOM auskommen.
//
// Vue 3 `app.mount()` braucht ein vollwertiges `window` (es nutzt
// document/HTMLElement-APIs intern), das wir hier nicht stellen wollen ohne
// jsdom-Dependency. Stattdessen prüfen wir:
//   - dass `createProjectPageHostRoute()` ein konsistentes Route-Record-
//     Shape zurückgibt;
//   - dass die Plattform die Inject-Keys `SUPER_ADMIN_EXTENSIONS_KEY` und
//     `SUPER_ADMIN_MANIFEST_KEY` exportiert (Vertrag mit dem App-Wiring);
//   - dass `useSuperAdminManifest()` ohne provided Accessor `null` liefert.
// Render-Fälle deckt der App-Build des Konsumenten am Live-DOM ab.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import {
    ProjectPageHost,
    SUPER_ADMIN_EXTENSIONS_KEY,
    SUPER_ADMIN_MANIFEST_KEY,
    createProjectPageHostRoute,
    useSuperAdminManifest,
} from '../dist/index.js';

describe('createProjectPageHostRoute', () => {
    test('liefert eine Catch-all-Route mit ProjectPageHost-Komponente', () => {
        const route = createProjectPageHostRoute();
        assert.equal(route.path, ':projectPagePath(.+)');
        assert.equal(route.component, ProjectPageHost);
        assert.equal(route.meta?.isProjectPageHost, true);
    });

    test('Pfad-Pattern lässt sich überschreiben', () => {
        const route = createProjectPageHostRoute({ path: ':bundleSlug' });
        assert.equal(route.path, ':bundleSlug');
        assert.equal(route.component, ProjectPageHost);
    });

    test('matcht nicht den leeren /admin-Pfad, damit das Dashboard-Redirect greift', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                {
                    path: '/admin',
                    children: [
                        { path: '', redirect: '/admin/dashboard' },
                        { path: 'dashboard', component: { name: 'DashboardStub' } },
                        createProjectPageHostRoute(),
                    ],
                },
            ],
        });

        await router.push('/admin');
        await router.isReady();
        assert.equal(router.currentRoute.value.fullPath, '/admin/dashboard');
        assert.deepEqual(
            router.currentRoute.value.matched.map((r) => r.path),
            ['/admin', '/admin/dashboard'],
        );

        await router.push('/admin/');
        assert.equal(router.currentRoute.value.fullPath, '/admin/dashboard');
        assert.deepEqual(
            router.currentRoute.value.matched.map((r) => r.path),
            ['/admin', '/admin/dashboard'],
        );
    });
});

describe('ProjectPageHost — Plattform-Vertrag', () => {
    test('exportiert SUPER_ADMIN_EXTENSIONS_KEY und SUPER_ADMIN_MANIFEST_KEY', () => {
        assert.equal(typeof SUPER_ADMIN_EXTENSIONS_KEY, 'symbol');
        assert.equal(typeof SUPER_ADMIN_MANIFEST_KEY, 'symbol');
    });

    test('ProjectPageHost ist eine defineComponent-kompatible Komponente', () => {
        assert.equal(typeof ProjectPageHost, 'object');
        assert.equal(ProjectPageHost.name, 'ProjectPageHost');
        assert.equal(typeof ProjectPageHost.setup, 'function');
    });
});

describe('useSuperAdminManifest', () => {
    test('liefert null, wenn kein Accessor provided wurde', () => {
        const app = createApp({ render: () => null });
        let result = 'unset';
        const Probe = defineComponent({
            setup() {
                result = useSuperAdminManifest();
                return () => null;
            },
        });
        // Inject ohne provide() laufen lassen
        app.runWithContext(() => {
            const probe = defineComponent({
                setup: Probe.setup,
                render: () => null,
            });
            // Direkt setup() ausführen — kein Mount nötig
            probe.setup();
        });
        assert.equal(result, null);
    });

    test('liefert den Manifest-Wert via provided Accessor', () => {
        const app = createApp({ render: () => null });
        const fakeManifest = { build: { manifestHash: 'abc' } };
        app.provide(SUPER_ADMIN_MANIFEST_KEY, () => fakeManifest);
        let result = null;
        app.runWithContext(() => {
            result = useSuperAdminManifest();
        });
        assert.equal(result, fakeManifest);
    });
});

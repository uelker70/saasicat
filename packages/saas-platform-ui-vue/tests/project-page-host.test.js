// ProjectPageHost — unit tests that work without a real DOM.
//
// Vue 3 `app.mount()` needs a full-fledged `window` (it uses
// document/HTMLElement APIs internally), which we don't want to provide here
// without a jsdom dependency. Instead we verify:
//   - that `createProjectPageHostRoute()` returns a consistent route-record
//     shape;
//   - that the platform exports the inject keys `SUPER_ADMIN_EXTENSIONS_KEY` and
//     `SUPER_ADMIN_MANIFEST_KEY` (contract with the app wiring);
//   - that `useSuperAdminManifest()` returns `null` without a provided accessor.
// Render cases are covered by the consumer's app build against the live DOM.

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
    test('returns a catch-all route with the ProjectPageHost component', () => {
        const route = createProjectPageHostRoute();
        assert.equal(route.path, ':projectPagePath(.+)');
        assert.equal(route.component, ProjectPageHost);
        assert.equal(route.meta?.isProjectPageHost, true);
    });

    test('path pattern can be overridden', () => {
        const route = createProjectPageHostRoute({ path: ':bundleSlug' });
        assert.equal(route.path, ':bundleSlug');
        assert.equal(route.component, ProjectPageHost);
    });

    test('does not match the empty /admin path so the dashboard redirect applies', async () => {
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

describe('ProjectPageHost — platform contract', () => {
    test('exports SUPER_ADMIN_EXTENSIONS_KEY and SUPER_ADMIN_MANIFEST_KEY', () => {
        assert.equal(typeof SUPER_ADMIN_EXTENSIONS_KEY, 'symbol');
        assert.equal(typeof SUPER_ADMIN_MANIFEST_KEY, 'symbol');
    });

    test('ProjectPageHost is a defineComponent-compatible component', () => {
        assert.equal(typeof ProjectPageHost, 'object');
        assert.equal(ProjectPageHost.name, 'ProjectPageHost');
        assert.equal(typeof ProjectPageHost.setup, 'function');
    });
});

describe('useSuperAdminManifest', () => {
    test('returns null when no accessor was provided', () => {
        const app = createApp({ render: () => null });
        let result = 'unset';
        const Probe = defineComponent({
            setup() {
                result = useSuperAdminManifest();
                return () => null;
            },
        });
        // Run inject without provide()
        app.runWithContext(() => {
            const probe = defineComponent({
                setup: Probe.setup,
                render: () => null,
            });
            // Run setup() directly — no mount needed
            probe.setup();
        });
        assert.equal(result, null);
    });

    test('returns the manifest value via a provided accessor', () => {
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

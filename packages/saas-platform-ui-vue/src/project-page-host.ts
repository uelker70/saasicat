// ProjectPageHost — universal host for manifest `projectPages`. Apps
// register a catch-all child route under their `/admin` layout; the
// host finds the ProjectPage in the manifest matching the current URL, resolves
// `componentKey` against the `extensions:` map (via
// `useSuperAdminExtensions()`) and renders the component.
//
// This means consumers don't have to additionally duplicate project pages
// statically in the router — manifest + extensions: map are the single source of truth.

import { computed, defineAsyncComponent, defineComponent, h, inject, type Component } from 'vue';
import { useRoute, type RouteRecordRaw } from 'vue-router';
import type { AdminManifest, ProjectPageDef } from '@saasicat/types';
import {
    SUPER_ADMIN_EXTENSIONS_KEY,
    SUPER_ADMIN_MANIFEST_KEY,
    type ExtensionsMap,
} from './create-super-admin-app.js';

// `defineAsyncComponent` gets its own wrapper component per loader
// function — without a cache, re-renders would recreate the same component
// and trigger the async resolve every time.
const asyncComponentCache = new WeakMap<ExtensionsMap, Map<string, Component>>();

function resolveAsync(extensions: ExtensionsMap, key: string): Component | null {
    let bucket = asyncComponentCache.get(extensions);
    if (!bucket) {
        bucket = new Map();
        asyncComponentCache.set(extensions, bucket);
    }
    const cached = bucket.get(key);
    if (cached) return cached;
    const loader = extensions[key];
    if (!loader) return null;
    const cmp = defineAsyncComponent(loader);
    bucket.set(key, cmp);
    return cmp;
}

export const ProjectPageHost = defineComponent({
    name: 'ProjectPageHost',
    setup() {
        const route = useRoute();
        const extensions = inject(SUPER_ADMIN_EXTENSIONS_KEY, {} as ExtensionsMap);
        const manifestAccessor = inject(SUPER_ADMIN_MANIFEST_KEY, null);

        const matchingPage = computed<ProjectPageDef | null>(() => {
            const manifest: AdminManifest | null = manifestAccessor ? manifestAccessor() : null;
            if (!manifest) return null;
            const pages = manifest.navigation?.projectPages ?? [];
            return pages.find((p) => p.route === route.path) ?? null;
        });

        const resolvedComponent = computed<Component | null>(() => {
            const page = matchingPage.value;
            if (!page) return null;
            return resolveAsync(extensions, page.componentKey);
        });

        return () => {
            const page = matchingPage.value;
            const cmp = resolvedComponent.value;
            if (page && cmp) return h(cmp);
            return h('div', { class: 'sa-project-page-host__missing', role: 'alert' }, [
                h('h2', 'Seite nicht verfügbar'),
                h(
                    'p',
                    page
                        ? `componentKey "${page.componentKey}" ist nicht in der extensions:-Map registriert. Apps müssen die Komponente in createSuperAdminApp({ extensions }) eintragen.`
                        : `Keine Manifest-Definition für ${route.path}. Entweder fehlt die ProjectPage im Manifest, oder die Capability ist nicht aktiv.`,
                ),
            ]);
        };
    },
});

/**
 * Returns a Vue Router child route that is registered as a catch-all under
 * the app's `/admin` layout. Children defined statically in the app router
 * (e.g. `/admin/dashboard`) win, because
 * Vue Router 4 matches specific routes before wildcard children.
 *
 * Example (simplified):
 *
 *     {
 *         path: '/admin',
 *         component: AdminLayout,
 *         children: [
 *             { path: '', redirect: '/admin/dashboard' },
 *             { path: 'dashboard', component: DashboardPage },
 *             // ...more static children
 *             createProjectPageHostRoute(),
 *         ],
 *     }
 */
export function createProjectPageHostRoute(options?: {
    /**
     * Path pattern of the catch-all route. Default `:projectPagePath(.+)`, so
     * that `/admin` and `/admin/` are not swallowed by the ProjectPageHost,
     * but the dashboard redirect child can take effect.
     */
    path?: string;
}): RouteRecordRaw {
    return {
        path: options?.path ?? ':projectPagePath(.+)',
        component: ProjectPageHost,
        meta: { isProjectPageHost: true },
    };
}

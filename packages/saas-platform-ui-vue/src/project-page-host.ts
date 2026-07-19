// ProjectPageHost — universeller Host für Manifest-`projectPages`. Apps
// registrieren eine Catch-all-Child-Route unter ihrem `/admin`-Layout, der
// Host findet die zur aktuellen URL passende ProjectPage im Manifest, löst
// `componentKey` gegen die `extensions:`-Map auf (per
// `useSuperAdminExtensions()`) und rendert die Komponente.
//
// Damit müssen Konsumenten Project-Pages nicht zusätzlich statisch im Router
// duplizieren — Manifest + extensions:-Map sind die Single Source of Truth.
//
// Spec: yada-services/handoff/superadmin/SPEC.md §4.4 (ProjectPage-Host).

import { computed, defineAsyncComponent, defineComponent, h, inject, type Component } from 'vue';
import { useRoute, type RouteRecordRaw } from 'vue-router';
import type { AdminManifest, ProjectPageDef } from '@saasicat/types';
import {
    SUPER_ADMIN_EXTENSIONS_KEY,
    SUPER_ADMIN_MANIFEST_KEY,
    type ExtensionsMap,
} from './create-super-admin-app.js';

// `defineAsyncComponent` bekommt pro Loader-Funktion eine eigene Wrapper-
// Komponente — ohne Cache würden Re-Renders dieselbe Komponente neu erzeugen
// und den Async-Resolve jedes Mal triggern.
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
 * Liefert eine Vue-Router-Child-Route, die als Catch-all unter dem
 * `/admin`-Layout der App registriert wird. Statisch im App-Router
 * definierte Children (z. B. `/admin/dashboard`) gewinnen, weil
 * Vue-Router-4 spezifische Routen vor Wildcard-Children matcht.
 *
 * Beispiel (vereinsfux, vereinfacht):
 *
 *     {
 *         path: '/admin',
 *         component: AdminLayout,
 *         children: [
 *             { path: '', redirect: '/admin/dashboard' },
 *             { path: 'dashboard', component: DashboardPage },
 *             // ...weitere Static-Children
 *             createProjectPageHostRoute(),
 *         ],
 *     }
 */
export function createProjectPageHostRoute(options?: {
    /**
     * Pfadmuster der Catch-all-Route. Default `:projectPagePath(.+)`, damit
     * `/admin` und `/admin/` nicht vom ProjectPageHost geschluckt werden,
     * sondern das Dashboard-Redirect-Child greifen kann.
     */
    path?: string;
}): RouteRecordRaw {
    return {
        path: options?.path ?? ':projectPagePath(.+)',
        component: ProjectPageHost,
        meta: { isProjectPageHost: true },
    };
}

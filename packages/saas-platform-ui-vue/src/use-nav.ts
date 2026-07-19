// useNav — Vue-3-Composable über NavBuilder.
//
// Wrappt einen reaktiven `Ref<AdminManifest | null>` (typischerweise aus
// `useManifest()`) und liefert reaktive `routes` + `sidebar` -ComputedRefs.

import { computed, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import {
    type BuildRouteEntry,
    type NavBuilderOptions,
    type SidebarSection,
    buildRoutes,
    buildSidebar,
} from './nav-builder.js';

export interface UseNavResult {
    /** Liste aller via Manifest verfügbaren Routen — nach Capabilities gefiltert. */
    routes: ComputedRef<BuildRouteEntry[]>;
    /** Drawer-Items, gruppiert nach navSection. */
    sidebar: ComputedRef<SidebarSection[]>;
}

export function useNav(
    manifest: Ref<AdminManifest | null>,
    options: NavBuilderOptions = {},
): UseNavResult {
    const routes = computed<BuildRouteEntry[]>(() => {
        if (!manifest.value) return [];
        return buildRoutes(manifest.value, options);
    });
    const sidebar = computed<SidebarSection[]>(() => buildSidebar(routes.value));
    return { routes, sidebar };
}

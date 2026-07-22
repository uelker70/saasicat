// useNav — Vue 3 composable over NavBuilder.
//
// Wraps a reactive `Ref<AdminManifest | null>` (typically from
// `useManifest()`) and returns reactive `routes` + `sidebar` ComputedRefs.

import { computed, type ComputedRef, type Ref } from 'vue';
import type { AdminManifest } from '@saasicat/types';
import {
    type BuildRouteEntry,
    type NavBuilderOptions,
    type SidebarSection,
    buildRoutes,
    buildSidebar,
} from '../client/nav-builder.js';

export interface UseNavResult {
    /** List of all routes available via the manifest — filtered by capabilities. */
    routes: ComputedRef<BuildRouteEntry[]>;
    /** Drawer items, grouped by navSection. */
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

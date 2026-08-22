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
    defaultSectionOrder,
} from '../client/nav-builder.js';
import { useSuperAdminI18n } from './use-super-admin-i18n.js';

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
    const { locale } = useSuperAdminI18n();
    const activeLocale = computed(() => options.locale ?? locale.value);
    const routes = computed<BuildRouteEntry[]>(() => {
        if (!manifest.value) return [];
        return buildRoutes(manifest.value, { ...options, locale: activeLocale.value });
    });
    const sidebar = computed<SidebarSection[]>(() =>
        buildSidebar(routes.value, defaultSectionOrder(activeLocale.value)),
    );
    return { routes, sidebar };
}

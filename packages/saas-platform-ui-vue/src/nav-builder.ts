// NavBuilder — derives the sidebar structure and the router mount points from
// a loaded `AdminManifest`. Platform standard pages have known
// routes (`/admin/tenants`, `/admin/subscriptions`, …); consumer
// `projectPages` are resolved to Vue components via the static
// `extensions:` map.
//
// Capability filter: sidebar items are only delivered when the
// respective `requiredCapability` in the manifest is set to `true` (or is
// not required at all). The manifest is Discovery, not security — the server
// enforces the routes independently.

import type {
    AdminManifest,
    StandardPageDef,
    StandardPageKey,
} from '@saasicat/types';

/**
 * Default routes for the platform standard pages. Consumers may override this
 * via the `standardPageRoutes` option (e.g. `/admin/users` →
 * `/admin/team`).
 */
export const DEFAULT_STANDARD_PAGE_ROUTES: Record<StandardPageKey, string> = {
    dashboard: '/admin/dashboard',
    tenants: '/admin/tenants',
    subscriptions: '/admin/subscriptions',
    promoCodes: '/admin/promo-codes',
    plans: '/admin/plans',
    planVersions: '/admin/plan-versions',
    audit: '/admin/audit',
    users: '/admin/users',
    pilots: '/admin/pilots',
    discovery: '/admin/discovery',
    bundles: '/admin/bundles',
    businessTypes: '/admin/business-types',
    marketingCatalog: '/admin/marketing-catalog',
    platformEmail: '/admin/platform-email',
    platformEmailHistory: '/admin/platform-email-history',
};

export interface BuildRouteEntry {
    /** Stable identifier — the key for standard pages, the `id` for project pages. */
    id: string;
    /** Route path (`/admin/...`). */
    path: string;
    /** Visible for the UI. */
    label: string;
    icon?: string;
    /** Sort key for drawer groups. */
    navSection?: string;
    /** Lookup key in the `extensions:` map (project) or the platform standard map. */
    componentKey: string;
    /** Required capability or null. */
    requiredCapability: string | null;
    /** Platform standard page (`true`) or project page (`false`). */
    isStandard: boolean;
    /** Hint for anticipatory lazy loading. */
    prefetchOnIdle?: boolean;
}

export interface NavBuilderOptions {
    /**
     * Optional: overrides the default routes for certain standard pages.
     * Consumers set this if they want an alternative URL structure.
     */
    standardPageRoutes?: Partial<Record<StandardPageKey, string>>;
    /**
     * Default labels for standard pages — consumers may localize.
     */
    standardPageLabels?: Partial<Record<StandardPageKey, string>>;
    /** Default icons for standard pages. */
    standardPageIcons?: Partial<Record<StandardPageKey, string>>;
    /** Default `navSection` for standard pages. */
    standardPageNavSection?: Partial<Record<StandardPageKey, string>>;
    /**
     * Optional: set of known `componentKey`s from the shell's `extensions:`
     * map. ProjectPages whose `componentKey` is not contained here
     * are filtered out — they would otherwise appear in the sidebar but on
     * click be redirected by the catch-all (silent dead link).
     * Consumers without an `extensions:` map omit the field → as before.
     */
    availableExtensions?: Set<string>;
}

const DEFAULT_LABELS: Record<StandardPageKey, string> = {
    dashboard: 'Dashboard',
    tenants: 'Mandanten',
    subscriptions: 'Abonnements',
    promoCodes: 'Promo-Codes',
    plans: 'Pläne & Versionen',
    planVersions: 'Plan-Versionen',
    audit: 'Audit-Log',
    users: 'Benutzer',
    pilots: 'Piloten',
    discovery: 'Discovery',
    bundles: 'Bundles',
    businessTypes: 'Geschäftstypen',
    marketingCatalog: 'Marketing-Catalog',
    platformEmail: 'Plattform-E-Mail',
    platformEmailHistory: 'E-Mail-Verlauf',
};

const DEFAULT_ICONS: Record<StandardPageKey, string> = {
    dashboard: 'dashboard',
    tenants: 'business',
    subscriptions: 'card_membership',
    promoCodes: 'local_activity',
    plans: 'workspace_premium',
    planVersions: 'history_edu',
    audit: 'history',
    users: 'people',
    pilots: 'flight_takeoff',
    discovery: 'travel_explore',
    bundles: 'inventory_2',
    businessTypes: 'category',
    marketingCatalog: 'campaign',
    platformEmail: 'mail',
    platformEmailHistory: 'mark_email_read',
};

const DEFAULT_NAV_SECTIONS: Partial<Record<StandardPageKey, string>> = {
    dashboard: 'Übersicht',
    discovery: 'Produktkatalog',
    businessTypes: 'Produktkatalog',
    bundles: 'Produktkatalog',
    plans: 'Produktkatalog',
    planVersions: 'Produktkatalog',
    marketingCatalog: 'Produktkatalog',
    promoCodes: 'Produktkatalog',
    tenants: 'Kunden',
    subscriptions: 'Kunden',
    users: 'Kunden',
    pilots: 'Kunden',
    audit: 'System',
    platformEmail: 'System',
    platformEmailHistory: 'System',
};

export const DEFAULT_SECTION_ORDER: readonly string[] = [
    'Übersicht',
    'Produktkatalog',
    'Kunden',
    'System',
];

/**
 * Returns the list of all routes defined by the current manifest —
 * filtered to the capabilities that the logged-in user has.
 *
 * The consumer shell then builds its Vue router configuration and its
 * sidebar drawer from it.
 */
export function buildRoutes(
    manifest: AdminManifest,
    options: NavBuilderOptions = {},
): BuildRouteEntry[] {
    const routes: BuildRouteEntry[] = [];
    const capabilities = manifest.capabilities ?? {};

    // StandardPages
    const standard = manifest.navigation?.standardPages ?? {};
    const overrideRoutes = { ...DEFAULT_STANDARD_PAGE_ROUTES, ...options.standardPageRoutes };
    const overrideLabels = { ...DEFAULT_LABELS, ...options.standardPageLabels };
    const overrideIcons = { ...DEFAULT_ICONS, ...options.standardPageIcons };
    const overrideNavSection = { ...DEFAULT_NAV_SECTIONS, ...options.standardPageNavSection };

    for (const key of Object.keys(standard) as StandardPageKey[]) {
        const def = standard[key] as StandardPageDef | undefined;
        if (!def?.enabled) continue;
        const cap = def.requiredCapability ?? null;
        if (cap && capabilities[cap] !== true) continue;
        routes.push({
            id: key,
            path: overrideRoutes[key],
            label: overrideLabels[key],
            icon: overrideIcons[key],
            navSection: overrideNavSection[key],
            componentKey: `platform-${key}`,
            requiredCapability: cap,
            isStandard: true,
        });
    }

    // ProjectPages
    const projectPages = manifest.navigation?.projectPages ?? [];
    const exts = options.availableExtensions;
    for (const p of projectPages) {
        const cap = p.requiredCapability ?? null;
        if (cap && capabilities[cap] !== true) continue;
        if (exts && !exts.has(p.componentKey)) continue;
        routes.push({
            id: p.id,
            path: p.route,
            label: p.label,
            icon: p.icon,
            navSection: p.navSection,
            componentKey: p.componentKey,
            requiredCapability: cap,
            isStandard: false,
            prefetchOnIdle: p.prefetchOnIdle,
        });
    }

    return routes;
}

export interface SidebarItem {
    id: string;
    path: string;
    label: string;
    icon?: string;
}

export interface SidebarSection {
    /** `null` for the default section (items without `navSection`). */
    section: string | null;
    items: SidebarItem[];
}

/**
 * Groups the routes by `navSection` for the drawer.
 *
 * Section order:
 *   1. Default section (`null`) — items without `navSection`.
 *   2. Sections from `sectionOrder` in exactly this order.
 *   3. Remaining sections alphabetically.
 *
 * The default order matches the plan simulation layout (Übersicht →
 * Produktkatalog → Kunden → System); consumers can override it.
 */
export function buildSidebar(
    routes: BuildRouteEntry[],
    sectionOrder: readonly string[] = DEFAULT_SECTION_ORDER,
): SidebarSection[] {
    const bySection = new Map<string | null, SidebarItem[]>();
    for (const r of routes) {
        const section = r.navSection ?? null;
        const list = bySection.get(section) ?? [];
        list.push({ id: r.id, path: r.path, label: r.label, icon: r.icon });
        bySection.set(section, list);
    }
    const sections: SidebarSection[] = [];
    if (bySection.has(null)) {
        sections.push({ section: null, items: bySection.get(null)! });
    }
    const ordered = new Set<string>();
    for (const name of sectionOrder) {
        if (bySection.has(name)) {
            sections.push({ section: name, items: bySection.get(name)! });
            ordered.add(name);
        }
    }
    const remaining = [...bySection.entries()]
        .filter(([s]) => s !== null && !ordered.has(s as string))
        .sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
    for (const [section, items] of remaining) {
        sections.push({ section: section as string, items });
    }
    return sections;
}

/**
 * Returns the Vue component registered for the given `componentKey`.
 * The consumer shell calls this function with its own `extensions:` map.
 * For unknown keys → `null` (the UI then renders a fallback
 * component, e.g. "Component not found in shell build").
 *
 * `extensions` is `Record<string, T>` — `T` is typically a
 * Vue component (either imported directly or as a
 * `defineAsyncComponent` wrapper).
 */
export function resolveExtension<T>(componentKey: string, extensions: Record<string, T>): T | null {
    return extensions[componentKey] ?? null;
}

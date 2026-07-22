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

import type { AdminManifest, StandardPageDef, StandardPageKey } from '@saasicat/types';

import { DEFAULT_SA_LOCALE, type SaLocale } from './i18n/locale.js';
import { navMessages } from './i18n/messages/nav.js';

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
     * UI locale for the default labels and section names, default `'de'`.
     * Pass the same locale to `buildSidebar()`'s `sectionOrder` (via
     * `defaultSectionOrder(locale)`) — section names are compared as strings.
     */
    locale?: SaLocale;
    /**
     * Optional: overrides the default routes for certain standard pages.
     * Consumers set this if they want an alternative URL structure.
     */
    standardPageRoutes?: Partial<Record<StandardPageKey, string>>;
    /**
     * Per-page label overrides layered over the locale defaults.
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

type SectionKey = keyof (typeof navMessages)['de']['sections'];

const PAGE_SECTIONS: Partial<Record<StandardPageKey, SectionKey>> = {
    dashboard: 'overview',
    discovery: 'catalog',
    businessTypes: 'catalog',
    bundles: 'catalog',
    plans: 'catalog',
    planVersions: 'catalog',
    marketingCatalog: 'catalog',
    promoCodes: 'catalog',
    tenants: 'customers',
    subscriptions: 'customers',
    users: 'customers',
    pilots: 'customers',
    audit: 'system',
    platformEmail: 'system',
    platformEmailHistory: 'system',
};

/**
 * Localized default section names in drawer order (Übersicht → Produktkatalog
 * → Kunden → System). Pass the result to `buildSidebar()` when building routes
 * with a non-default locale.
 */
export function defaultSectionOrder(locale: SaLocale = DEFAULT_SA_LOCALE): readonly string[] {
    const sections = navMessages[locale].sections;
    return [sections.overview, sections.catalog, sections.customers, sections.system];
}

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
    const nav = navMessages[options.locale ?? DEFAULT_SA_LOCALE];
    const defaultNavSections: Partial<Record<StandardPageKey, string>> = Object.fromEntries(
        Object.entries(PAGE_SECTIONS).map(([page, section]) => [page, nav.sections[section]]),
    );
    const overrideRoutes = { ...DEFAULT_STANDARD_PAGE_ROUTES, ...options.standardPageRoutes };
    const overrideLabels = { ...nav.pages, ...options.standardPageLabels };
    const overrideIcons = { ...DEFAULT_ICONS, ...options.standardPageIcons };
    const overrideNavSection = { ...defaultNavSections, ...options.standardPageNavSection };

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
    sectionOrder: readonly string[] = defaultSectionOrder(),
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

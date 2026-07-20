// NavBuilder — leitet die Sidebar-Struktur und die Router-Mountpoints aus
// einem geladenen `AdminManifest` ab. Plattform-StandardPages haben bekannte
// Routen (`/admin/tenants`, `/admin/subscriptions`, …); Konsumenten-
// `projectPages` werden über die statische `extensions:`-Map zu
// Vue-Komponenten aufgelöst.
//
// Capability-Filter: Sidebar-Items werden nur ausgeliefert, wenn die
// jeweilige `requiredCapability` im Manifest auf `true` steht (oder gar
// nicht gefordert ist). Manifest ist Discovery, nicht Security — der Server
// enforcet die Routen unabhängig.

import type {
    AdminManifest,
    StandardPageDef,
    StandardPageKey,
} from '@saasicat/types';

/**
 * Default-Routen für die Plattform-StandardPages. Konsumenten dürfen das
 * via `standardPageRoutes`-Option überschreiben (z. B. `/admin/users` →
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
    /** Stable Identifier — bei StandardPages der Schlüssel, bei ProjectPages die `id`. */
    id: string;
    /** Route-Pfad (`/admin/...`). */
    path: string;
    /** Sichtbar fürs UI. */
    label: string;
    icon?: string;
    /** Sortierschlüssel für Drawer-Gruppen. */
    navSection?: string;
    /** Lookup-Key in der `extensions:`-Map (project) bzw. der Plattform-Standard-Map. */
    componentKey: string;
    /** Pflicht-Capability oder null. */
    requiredCapability: string | null;
    /** Plattform-Standard-Page (`true`) oder Projekt-Page (`false`). */
    isStandard: boolean;
    /** Hint für vorausschauendes Lazy-Loading. */
    prefetchOnIdle?: boolean;
}

export interface NavBuilderOptions {
    /**
     * Optional: Überschreibt die Default-Routen für bestimmte StandardPages.
     * Konsumenten setzen das, wenn sie eine alternative URL-Struktur wollen.
     */
    standardPageRoutes?: Partial<Record<StandardPageKey, string>>;
    /**
     * Default-Labels für StandardPages — Konsumenten dürfen lokalisieren.
     */
    standardPageLabels?: Partial<Record<StandardPageKey, string>>;
    /** Default-Icons für StandardPages. */
    standardPageIcons?: Partial<Record<StandardPageKey, string>>;
    /** Default-`navSection` für StandardPages. */
    standardPageNavSection?: Partial<Record<StandardPageKey, string>>;
    /**
     * Optional: Set bekannter `componentKey`s aus der `extensions:`-Map der
     * Shell. ProjectPages, deren `componentKey` hier nicht enthalten ist,
     * werden gefiltert — sie würden sonst in der Sidebar erscheinen, beim
     * Klick aber durch den Catch-all redirected (silent dead-link).
     * Konsumenten ohne `extensions:`-Map lassen das Feld weg → wie bisher.
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
 * Liefert die Liste aller Routen, die das aktuelle Manifest definiert —
 * gefiltert auf die Capabilities, die der eingeloggte User besitzt.
 *
 * Konsument-Shell baut daraus dann ihre Vue-Router-Konfiguration und ihren
 * Sidebar-Drawer.
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
    /** `null` für die Default-Sektion (Items ohne `navSection`). */
    section: string | null;
    items: SidebarItem[];
}

/**
 * Gruppiert die Routen nach `navSection` für den Drawer.
 *
 * Section-Reihenfolge:
 *   1. Default-Sektion (`null`) — Items ohne `navSection`.
 *   2. Sektionen aus `sectionOrder` in genau dieser Reihenfolge.
 *   3. Übrige Sektionen alphabetisch.
 *
 * Default-Reihenfolge entspricht dem Plan-Simulation-Layout (Übersicht →
 * Produktkatalog → Kunden → System); Konsumenten können sie überschreiben.
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
 * Liefert die zum gegebenen `componentKey` registrierte Vue-Komponente.
 * Konsumenten-Shell ruft diese Funktion mit ihrer eigenen `extensions:`-Map
 * auf. Bei unbekannten Keys → `null` (UI rendert dann eine Fallback-
 * Komponente, z. B. „Component not found in shell build").
 *
 * `extensions` ist `Record<string, T>` — `T` ist typischerweise eine
 * Vue-Component (entweder direkt importiert oder als
 * `defineAsyncComponent`-Wrapper).
 */
export function resolveExtension<T>(componentKey: string, extensions: Record<string, T>): T | null {
    return extensions[componentKey] ?? null;
}

// Tenant-Manifest — UI-Snapshot pro Tenant. Liefert Features+Quotas (aus
// Entitlement) plus eine gefilterte Navigation, sodass die App-UI Sichtbarkeit
// von Menü-Punkten/Routen deklarativ vom Backend bekommt — analog zum
// AdminManifest, aber für die Tenant-User-UI.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P14.

export interface TenantNavItem {
    /** Eindeutiger Slug, z. B. "notes", "billing", "settings". */
    id: string;
    /** Anzeige-Label (übersetzbar — Pattern siehe AdminManifest). */
    label: string;
    /** Frontend-Route, z. B. "/notes". */
    path: string;
    /** Optional: Quasar/Material-Icon. */
    icon?: string;
    /** Sortier-Priorität, niedriger = weiter oben. Default 100. */
    order?: number;
    /**
     * Wenn gesetzt, ist der Item nur sichtbar, wenn der Tenant **eines**
     * dieser Features hat. Backend filtert serverseitig — die App kann sich
     * darauf verlassen, dass nur erlaubte Items im Manifest stehen.
     */
    requiresFeature?: string | readonly string[];
}

export interface TenantManifest {
    schemaVersion: 1;
    /** Tenant-Identität, an die das Manifest gebunden ist. */
    tenant: { id: string };
    /** Aktiver Plan (aus PlanResolverPort bzw. SubscriptionContract). */
    planId: string | null;
    /** Freigeschaltete Features (Set als Array). */
    features: readonly string[];
    /** quotaKey → Limit (`-1` = unbegrenzt). */
    quotas: Readonly<Record<string, number>>;
    /** Sichtbare Navigation, bereits nach Feature gefiltert. */
    navigation: TenantNavItem[];
}

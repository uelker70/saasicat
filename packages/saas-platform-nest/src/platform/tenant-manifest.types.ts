// Tenant manifest — UI snapshot per tenant. Delivers features+quotas (from
// Entitlement) plus a filtered navigation, so the app UI gets visibility of
// menu items/routes declaratively from the backend — analogous to the
// AdminManifest, but for the tenant user UI.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P14.

export interface TenantNavItem {
    /** Unique slug, e.g. "notes", "billing", "settings". */
    id: string;
    /** Display label (translatable — see AdminManifest for the pattern). */
    label: string;
    /** Frontend route, e.g. "/notes". */
    path: string;
    /** Optional: Quasar/Material icon. */
    icon?: string;
    /** Sort priority, lower = higher up. Default 100. */
    order?: number;
    /**
     * When set, the item is only visible if the tenant has **one** of these
     * features. The backend filters server-side — the app can rely on only
     * permitted items being present in the manifest.
     */
    requiresFeature?: string | readonly string[];
}

export interface TenantManifest {
    schemaVersion: 1;
    /** Tenant identity the manifest is bound to. */
    tenant: { id: string };
    /** Active plan (from PlanResolverPort or SubscriptionContract). */
    planId: string | null;
    /** Unlocked features (set as array). */
    features: readonly string[];
    /** quotaKey → limit (`-1` = unlimited). */
    quotas: Readonly<Record<string, number>>;
    /** Visible navigation, already filtered by feature. */
    navigation: TenantNavItem[];
}

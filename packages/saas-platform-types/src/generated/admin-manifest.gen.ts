// AUTO-GENERATED — nicht manuell editieren.
//
// Quelle: @saasicat/spec/schemas/admin-manifest.schema.json
// Regenerieren: `pnpm --filter @saasicat/types gen:types`
// Drift-Gate: tests/codegen-drift.test.js bricht den PR, wenn Schema und
// generierter Output auseinanderlaufen.

export type CapabilityKey = string;

/**
 * UI-Discovery-Projektion einer SaaS-App. Wird vom App-Backend unter GET /api/v1/admin/manifest ausgeliefert und vom Shared-UI-Shell konsumiert.
 */
export interface AdminManifest {
    schemaVersion: 1;
    project: {
        key: string;
        displayName: string;
        /**
         * Tag/Untertitel (z. B. "SuperAdmin"). Aus saas.yaml#app.label.
         */
        label?: string;
        /**
         * Kurz-Kürzel für das Logo-Badge (z. B. "cf", "vf"). Aus saas.yaml#app.icon.
         */
        icon?: string;
        logoUrl?: string;
        environment?: 'production' | 'staging' | 'development';
        /**
         * Vom App-Catalog (saas.yaml marketing.availableLocales) erlaubte Locales. Erste = Default. SPEC_V2 §6.5.
         *
         * @minItems 1
         */
        availableLocales?: [string, ...string[]];
        /**
         * Default-Locale; entspricht availableLocales[0].
         */
        defaultLocale?: string;
    };
    build: {
        platformPackageVersion: string;
        appVersion: string;
        manifestHash: string;
    };
    planCatalogSnapshot: {
        /**
         * Pfad zur Quelle, z. B. 'config/saas.yaml'
         */
        source: string;
        hash: string;
        currency: string;
        vatRate: number;
        /**
         * @minItems 1
         */
        quotaKeys: [string, ...string[]];
        features?: {
            key: string;
            label?: string;
            tier?: string;
        }[];
        /**
         * @minItems 1
         */
        plans: [PlanDef, ...PlanDef[]];
    };
    /**
     * Backend-Capabilities. Naming-Konvention: domain.action oder domain.resource.action. Werte sind boolean (true = aktiv im Build).
     */
    capabilities: {
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)?$".
         */
        [k: string]: boolean;
    };
    navigation: {
        standardPages: {
            dashboard?: StandardPageDef;
            tenants?: StandardPageDef;
            subscriptions?: StandardPageDef;
            promoCodes?: StandardPageDef;
            plans?: StandardPageDef;
            planVersions?: StandardPageDef;
            audit?: StandardPageDef;
            users?: StandardPageDef;
            pilots?: StandardPageDef;
            discovery?: StandardPageDef;
            bundles?: StandardPageDef;
            businessTypes?: StandardPageDef;
            marketingCatalog?: StandardPageDef;
            platformEmail?: StandardPageDef;
            platformEmailHistory?: StandardPageDef;
        };
        projectPages?: ProjectPageDef[];
    };
    dashboard?: {
        kpiCards?: KpiCardDef[];
    };
    tenants?: {
        columns?: TenantColumnDef[];
        actions?: TenantActionDef[];
    };
    audit?: {
        actions?: {
            key: string;
            label: string;
            severity?: 'info' | 'low' | 'medium' | 'high';
        }[];
    };
}
export interface PlanDef {
    id: string;
    name?: string;
    tagline?: string;
    marketed?: boolean;
    popular?: boolean;
    monthlyNet?: number | null;
    yearlyNet?: number | null;
    quotas: {
        /**
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[a-z][A-Za-z0-9]*$".
         */
        [k: string]: number;
    };
    features: string[];
}
export interface StandardPageDef {
    enabled: boolean;
    requiredCapability?: CapabilityKey;
}
export interface ProjectPageDef {
    id: string;
    label: string;
    icon?: string;
    route: string;
    navSection?: string;
    componentKey: string;
    requiredCapability?: CapabilityKey;
    prefetchOnIdle?: boolean;
}
export interface KpiCardDef {
    id: string;
    label: string;
    endpoint: string;
    displayHint: {
        type: 'value' | 'value+timestamp' | 'value+spark8w' | 'value+delta';
        icon?: string;
    };
    slotPriority?: number;
    requiredCapability?: CapabilityKey;
}
export interface TenantColumnDef {
    key: string;
    label: string;
    /**
     * Pflicht: batchfähiger Endpoint, kein Tenant-Slug im Pfad. UI ruft mit ?tenantIds=... auf. Siehe SPEC §4.4.1.
     */
    endpoint: string;
    requiredCapability?: CapabilityKey;
}
export interface TenantActionDef {
    id: string;
    label: string;
    /**
     * Lookup in der Frontend-Action-Registry. KEIN endpoint/method hier.
     */
    actionKey: string;
    requiredCapability?: CapabilityKey;
    requiresMfa?: boolean;
    confirmType?: 'none' | 'simple' | 'typed-slug' | 'typed-production' | 'date';
}

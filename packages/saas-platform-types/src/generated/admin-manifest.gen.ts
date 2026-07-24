// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/admin-manifest.schema.json
// Regenerate: `pnpm --filter @saasicat/types gen:types`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.

export type CapabilityKey = string;

/**
 * UI discovery projection of a SaaS app. Served by the app backend under GET /api/v1/admin/manifest and consumed by the shared UI shell.
 */
export interface AdminManifest {
    schemaVersion: 1;
    project: {
        key: string;
        displayName: string;
        /**
         * Tag/subtitle (e.g. "SuperAdmin"). From saas.yaml#app.label.
         */
        label?: string;
        /**
         * Short abbreviation for the logo badge (e.g. "ma", "da"). From saas.yaml#app.icon.
         */
        icon?: string;
        logoUrl?: string;
        environment?: 'production' | 'staging' | 'development';
        /**
         * Locales allowed by the app catalog (saas.yaml marketing.availableLocales). First = default. SPEC_V2 §6.5.
         *
         * @minItems 1
         */
        availableLocales?: [string, ...string[]];
        /**
         * Default locale; corresponds to availableLocales[0].
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
         * Path to the source, e.g. 'config/saas.yaml'
         */
        source: string;
        hash: string;
        currency: string;
        vatRate: number;
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
     * Backend capabilities. Naming convention: domain.action or domain.resource.action. Values are boolean (true = active in the build).
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
            audit?: StandardPageDef;
            users?: StandardPageDef;
            pilots?: StandardPageDef;
            discovery?: StandardPageDef;
            bundles?: StandardPageDef;
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
     * Required: batch-capable endpoint, no tenant slug in the path. UI calls it with ?tenantIds=... See SPEC §4.4.1.
     */
    endpoint: string;
    requiredCapability?: CapabilityKey;
}
export interface TenantActionDef {
    id: string;
    label: string;
    /**
     * Lookup in the frontend action registry. NO endpoint/method here.
     */
    actionKey: string;
    requiredCapability?: CapabilityKey;
    requiresMfa?: boolean;
    confirmType?: 'none' | 'simple' | 'typed-slug' | 'typed-production' | 'date';
}

// AdminManifest — UI-Discovery-Projektion einer SaaS-App.
// Schema-Quelle: @saasicat/spec/schemas/admin-manifest.schema.json
// Spec: yada-services/handoff/superadmin/SPEC.md §4.2

import type { FeatureDef, PlanDef, QuotaKey } from './plan-catalog.types.js';

/** Backend-Capability-Key, Konvention: domain.action[.action]. */
export type CapabilityKey = string;

/** Frontend-Action-Registry-Key. Konvention wie CapabilityKey. */
export type ActionKey = CapabilityKey;

/** Lookup-Key in der statischen extensions:-Map des UI-Builds. */
export type ComponentKey = string;

export interface AdminManifest {
    schemaVersion: 1;

    project: {
        key: string;
        displayName: string;
        /** Tag/Untertitel (z. B. "SuperAdmin"). Aus `saas.yaml#app.label`. */
        label?: string;
        /** Kurz-Kürzel für das Logo-Badge (z. B. "ah", "vf"). Aus `saas.yaml#app.icon`. */
        icon?: string;
        logoUrl?: string;
        environment?: 'production' | 'staging' | 'development';
        /**
         * Erlaubter Locale-Pool aus der app-config (`saas.yaml`
         * `marketing.availableLocales`). Erste = Default. SPEC_V2 §6.5.
         */
        availableLocales?: string[];
        /** Default-Locale; entspricht `availableLocales[0]`. */
        defaultLocale?: string;
    };

    build: {
        platformPackageVersion: string;
        appVersion: string;
        manifestHash: string;
    };

    planCatalogSnapshot: {
        source: string;
        hash: string;
        currency: string;
        vatRate: number;
        quotaKeys: QuotaKey[];
        features?: FeatureDef[];
        plans: PlanDef[];
    };

    /** Map CapabilityKey → boolean. Manifest ist nie Security-Quelle. */
    capabilities: Record<CapabilityKey, boolean>;

    navigation: {
        standardPages: Partial<Record<StandardPageKey, StandardPageDef>>;
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
        actions?: AuditActionDef[];
    };
}

export type StandardPageKey =
    | 'dashboard'
    | 'tenants'
    | 'subscriptions'
    | 'promoCodes'
    | 'plans'
    | 'planVersions'
    | 'audit'
    | 'users'
    | 'pilots'
    | 'discovery'
    | 'bundles'
    | 'businessTypes'
    | 'marketingCatalog'
    | 'platformEmail'
    | 'platformEmailHistory';

export interface StandardPageDef {
    enabled: boolean;
    requiredCapability?: CapabilityKey;
}

export interface ProjectPageDef {
    /** `<projectKey>.<area>`, z. B. `autohauspro.datev`. */
    id: string;
    label: string;
    icon?: string;
    /** Frontend-Route, z. B. `/admin/datev`. */
    route: string;
    navSection?: string;
    /** Lookup in der statischen extensions:-Map des Shell-Builds. */
    componentKey: ComponentKey;
    requiredCapability?: CapabilityKey;
    prefetchOnIdle?: boolean;
}

export interface KpiCardDef {
    id: string;
    label: string;
    /** Pflicht-Pfad: /api/v1/admin/(extras|dashboard)/... */
    endpoint: string;
    displayHint: KpiDisplayHint;
    /** 0–100; UI sortiert absteigend. */
    slotPriority?: number;
    requiredCapability?: CapabilityKey;
}

export interface KpiDisplayHint {
    type: 'value' | 'value+timestamp' | 'value+spark8w' | 'value+delta';
    icon?: string;
}

export interface TenantColumnDef {
    key: string;
    label: string;
    /** Pflicht-Pfad: /api/v1/admin/extras/...; MUSS batchfähig sein, kein {slug}/{tenantId}. */
    endpoint: string;
    requiredCapability?: CapabilityKey;
}

export interface TenantActionDef {
    /** `<projectKey>.<area>.<verb>`, z. B. `autohauspro.datev.runExport`. */
    id: string;
    label: string;
    /** Lookup in der statischen actions:-Map des Shell-Builds. */
    actionKey: ActionKey;
    requiredCapability?: CapabilityKey;
    requiresMfa?: boolean;
    confirmType?: 'none' | 'simple' | 'typed-slug' | 'typed-production' | 'date';
}

export interface AuditActionDef {
    /** SCREAMING_SNAKE_CASE; matched zur AuditLog.action-Spalte. */
    key: string;
    label: string;
    severity?: 'info' | 'low' | 'medium' | 'high';
}

// ──────────────────────────────────────────────────────────────────
// ManifestContribution — wird von App-Modulen via DI geliefert und
// im AdminManifestService zum Voll-Manifest gemerged.
// ──────────────────────────────────────────────────────────────────

export interface ManifestContribution {
    capabilities?: Record<CapabilityKey, boolean>;
    navigation?: {
        standardPages?: Partial<Record<StandardPageKey, StandardPageDef>>;
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
        actions?: AuditActionDef[];
    };
}

// ──────────────────────────────────────────────────────────────────
// PublicBootResponse — Pre-Login-Endpoint /api/v1/admin/boot
// Bewusst nur Branding, NIEMALS Capabilities/Pages/Endpoints.
// ──────────────────────────────────────────────────────────────────

export interface PublicBootResponse {
    project: {
        key: string;
        displayName: string;
        /** Tag/Untertitel (z. B. "SuperAdmin"). Aus `saas.yaml#app.label`. */
        label?: string;
        /** Kurz-Kürzel für das Logo-Badge (z. B. "ah", "vf"). Aus `saas.yaml#app.icon`. */
        icon?: string;
        logoUrl?: string;
        environment?: 'production' | 'staging' | 'development';
    };
}

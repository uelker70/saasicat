// AdminManifest — UI discovery projection of a SaaS app.
// Schema source: @saasicat/spec/schemas/admin-manifest.schema.json

import type { FeatureDef, PlanDef } from './plan-catalog.types.js';

/** Backend capability key, convention: domain.action[.action]. */
export type CapabilityKey = string;

/** Frontend action-registry key. Same convention as CapabilityKey. */
export type ActionKey = CapabilityKey;

/** Lookup key in the static extensions: map of the UI build. */
export type ComponentKey = string;

export interface AdminManifest {
    schemaVersion: 1;

    project: {
        key: string;
        displayName: string;
        /** Tag/subtitle (e.g. "SuperAdmin"). From `saas.yaml#app.label`. */
        label?: string;
        /** Short abbreviation for the logo badge (e.g. "ma", "da"). From `saas.yaml#app.icon`. */
        icon?: string;
        logoUrl?: string;
        environment?: 'production' | 'staging' | 'development';
        /**
         * Allowed locale pool from the app config (`saas.yaml`
         * `marketing.availableLocales`). First = default. SPEC_V2 §6.5.
         */
        availableLocales?: string[];
        /** Default locale; equals `availableLocales[0]`. */
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
        features?: FeatureDef[];
        plans: PlanDef[];
    };

    /** Map CapabilityKey → boolean. Manifest is never a security source. */
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
    | 'marketingCatalog'
    | 'platformEmail'
    | 'platformEmailHistory';

export interface StandardPageDef {
    enabled: boolean;
    requiredCapability?: CapabilityKey;
}

export interface ProjectPageDef {
    /** `<projectKey>.<area>`, e.g. `demoapp.datev`. */
    id: string;
    label: string;
    icon?: string;
    /** Frontend route, e.g. `/admin/datev`. */
    route: string;
    navSection?: string;
    /** Lookup in the static extensions: map of the shell build. */
    componentKey: ComponentKey;
    requiredCapability?: CapabilityKey;
    prefetchOnIdle?: boolean;
}

export interface KpiCardDef {
    id: string;
    label: string;
    /** Required path: /api/v1/admin/(extras|dashboard)/... */
    endpoint: string;
    displayHint: KpiDisplayHint;
    /** 0–100; UI sorts descending. */
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
    /** Required path: /api/v1/admin/extras/...; MUST be batch-capable, no {slug}/{tenantId}. */
    endpoint: string;
    requiredCapability?: CapabilityKey;
}

export interface TenantActionDef {
    /** `<projectKey>.<area>.<verb>`, e.g. `demoapp.datev.runExport`. */
    id: string;
    label: string;
    /** Lookup in the static actions: map of the shell build. */
    actionKey: ActionKey;
    requiredCapability?: CapabilityKey;
    requiresMfa?: boolean;
    confirmType?: 'none' | 'simple' | 'typed-slug' | 'typed-production' | 'date';
}

export interface AuditActionDef {
    /** SCREAMING_SNAKE_CASE; matched to the AuditLog.action column. */
    key: string;
    label: string;
    severity?: 'info' | 'low' | 'medium' | 'high';
}

// ──────────────────────────────────────────────────────────────────
// ManifestContribution — supplied by app modules via DI and merged
// into the full manifest in the AdminManifestService.
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
// PublicBootResponse — pre-login endpoint /api/v1/admin/boot
// Deliberately branding only, NEVER capabilities/pages/endpoints.
// ──────────────────────────────────────────────────────────────────

export interface PublicBootResponse {
    project: {
        key: string;
        displayName: string;
        /** Tag/subtitle (e.g. "SuperAdmin"). From `saas.yaml#app.label`. */
        label?: string;
        /** Short abbreviation for the logo badge (e.g. "ma", "da"). From `saas.yaml#app.icon`. */
        icon?: string;
        logoUrl?: string;
        environment?: 'production' | 'staging' | 'development';
    };
}

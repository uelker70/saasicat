// PlanCatalog — format of the `config/saas.yaml` file.
// Schema source: @saasicat/spec/schemas/plan-catalog.schema.json

export type FeatureKey = string; // SCREAMING_SNAKE_CASE; own namespace per consumer
export type PlanId = string; // SCREAMING_SNAKE_CASE; e.g. BASIC, STANDARD, PROFESSIONAL
export type QuotaKey = string; // camelCase; e.g. users, vehicles, members, storageGb

export interface FeatureDef {
    key: FeatureKey;
    label?: string;
    icon?: string;
    /** CORE / ADVANCED / PRO / BUSINESS / ENTERPRISE_ONLY — convention. */
    tier?: string;
    plannedOnly?: boolean;
}

export interface PlanDef {
    id: PlanId;
    name?: string;
    tagline?: string;
    /** false = not selectable in self-service onboarding. Default: true. */
    marketed?: boolean;
    /** Highlighted card in onboarding (max. 1 per catalog). */
    popular?: boolean;
    /** Net monthly price. null = on request. */
    monthlyNet?: number | null;
    /** Net total amount per year. null = monthly only. */
    yearlyNet?: number | null;
    /** Map quotaKey → max value. -1 = unlimited. */
    quotas: Record<QuotaKey, number>;
    features: FeatureKey[];
}

/** App-wide marketing configuration (SPEC_V2 §6.5). */
export interface PlanCatalogMarketing {
    /**
     * Allowed language pool that the app may market. First = default
     * locale. From it, the SuperAdmin activates a subset in the marketing
     * catalog (LocaleManager).
     */
    availableLocales: string[];
}

/**
 * App identity block for branding + version. Consumed by the `AdminPublicBootController`
 * and the `AdminManifestConfigFactory`; the SuperAdmin UI (platform
 * LoginPage, AdminLayout brand block) reads the same fields via PublicBoot.
 *
 * `name` = brand display name (e.g. "DemoApp", "ClubApp").
 * `label` = tag/subtitle in the brand block (e.g. "SuperAdmin").
 * `version` = app version string (build info).
 * `icon` = 2-character abbreviation for the logo badge (e.g. "ma", "da").
 * `logoUrl` = optional URL to a PNG/SVG; if set, the UI renders an <img>
 *             instead of the initials badge.
 */
export interface PlanCatalogApp {
    name: string;
    label?: string;
    version?: string;
    icon?: string;
    logoUrl?: string;
}

export interface PlanCatalog {
    schemaVersion: 1;
    projectKey: string;
    /** App identity (branding + version), see PlanCatalogApp. Optional. */
    app?: PlanCatalogApp;
    /** ISO-4217 currency code. */
    currency: string;
    /** VAT rate in percent. */
    vatRate: number;
    /** App-wide marketing configuration (SPEC_V2 §6.5). Optional. */
    marketing?: PlanCatalogMarketing;
    features?: FeatureDef[];
    /**
     * Optional. When omitted, plans come exclusively from the
     * AdminUI / DB table (Plans/PlanVersions lifecycle).
     */
    plans?: PlanDef[];
}

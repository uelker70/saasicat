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

/** App-wide marketing configuration. */
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

/**
 * Notice periods, one per rhythm.
 *
 * One number for both was the shape until 2026-08-27, and it could not be right
 * for both: a yearly contract with a fortnight of notice is unusual, and a
 * monthly contract with three months of notice is void against a consumer. The
 * two are configured apart because real contracts set them apart.
 *
 * Both members are required. A missing rhythm would read as zero, and a silent
 * zero is a commercial decision nobody made — the same defect one level below
 * the one that moved these settings into the file.
 *
 * **No ceiling is enforced.** §309 Nr. 9 BGB limits the notice period in German
 * consumer contracts to one month, and an installation serving businesses is
 * not bound by it. The platform cannot know which it is, so the number is the
 * consumer app's to choose and this is the sentence that says what it costs.
 */
export interface CancellationNoticePeriods {
    /** Days of notice for a monthly subscription. */
    monthly: number;
    /** Days of notice for a yearly subscription. */
    yearly: number;
}

/**
 * Plans a tenant may not reach or leave without talking to sales.
 *
 * `asTarget`: may not be selected via self-service — typically ENTERPRISE,
 * which only a special contract activates. `asSource`: may not be left via
 * self-service — typically an active special contract.
 *
 * Both lists are required and may be empty. An empty list says out loud that
 * self-service reaches every plan, which is a decision rather than an omission.
 */
export interface SelfServiceBlockedPlans {
    asTarget: string[];
    asSource: string[];
}

/**
 * Commercial settings for the tenant-facing self-service routes.
 *
 * They live in `config/saas.yaml` and nowhere else: an operator reading the
 * file has to be reading the values that are running, with no "unless somebody
 * passed it in code" attached. The file is read at boot, so an edit lands on
 * the next restart.
 */
export interface PlanCatalogTenantBilling {
    cancellationNoticeDays: CancellationNoticePeriods;
    selfServiceBlockedPlans: SelfServiceBlockedPlans;
}

/**
 * Who is told when the settings in the file change between two starts.
 *
 * The record inside the application is written whether or not anybody is
 * named here; mail is the addition, never the substitute. Mailed only where an
 * email port is bound — without one the boot log says so once, and the change
 * is recorded in the application only.
 */
export interface PlanCatalogNotifications {
    /** Addresses mailed when a start finds the applied settings changed. */
    settingsChanged?: string[];
}

export interface PlanCatalog {
    schemaVersion: 1;
    /** App identity (branding + version), see PlanCatalogApp. */
    app: PlanCatalogApp;
    /** ISO-4217 currency code. */
    currency: string;
    /** VAT rate in percent. */
    vatRate: number;
    /** Commercial settings for the tenant self-service routes. */
    tenantBilling: PlanCatalogTenantBilling;
    /** App-wide marketing configuration. Optional. */
    marketing?: PlanCatalogMarketing;
    /** Who is told when the settings change between two starts. Optional. */
    notifications?: PlanCatalogNotifications;
    features?: FeatureDef[];
    /**
     * Optional. When omitted, plans come exclusively from the
     * AdminUI / DB table (Plans/PlanVersions lifecycle).
     */
    plans?: PlanDef[];
}

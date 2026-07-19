// PlanCatalog — Format der `config/saas.yaml`-Datei.
// Schema-Quelle: @saasicat/spec/schemas/plan-catalog.schema.json
// Spec: yada-services/handoff/superadmin/SPEC.md §4

export type FeatureKey = string; // SCREAMING_SNAKE_CASE; pro Konsument eigener Namespace
export type PlanId = string; // SCREAMING_SNAKE_CASE; z. B. BASIC, STANDARD, PROFESSIONAL
export type QuotaKey = string; // camelCase; z. B. users, vehicles, members, storageGb

export interface FeatureDef {
    key: FeatureKey;
    label?: string;
    icon?: string;
    /** CORE / ADVANCED / PRO / BUSINESS / ENTERPRISE_ONLY — Konvention. */
    tier?: string;
    plannedOnly?: boolean;
}

export interface PlanDef {
    id: PlanId;
    name?: string;
    tagline?: string;
    /** false = nicht im Self-Service-Onboarding wählbar. Default: true. */
    marketed?: boolean;
    /** Highlighted-Karte im Onboarding (max. 1 pro Catalog). */
    popular?: boolean;
    /** Netto-Monatspreis. null = auf Anfrage. */
    monthlyNet?: number | null;
    /** Netto-Gesamtbetrag pro Jahr. null = nur monatlich. */
    yearlyNet?: number | null;
    /** Map quotaKey → max-Wert. -1 = unbegrenzt. */
    quotas: Record<QuotaKey, number>;
    features: FeatureKey[];
}

/** App-weite Marketing-Konfiguration (SPEC_V2 §6.5). */
export interface PlanCatalogMarketing {
    /**
     * Erlaubter Sprach-Pool, den die App vermarkten darf. Erste = Default-
     * Locale. Der SuperAdmin aktiviert daraus im Marketing-Catalog eine
     * Teilmenge (LocaleManager).
     */
    availableLocales: string[];
}

/**
 * App-Identity-Block für Branding + Version. Wird vom `AdminPublicBootController`
 * und der `AdminManifestConfigFactory` konsumiert; das SuperAdmin-UI (Plattform-
 * LoginPage, AdminLayout-Brand-Block) liest dieselben Felder via PublicBoot.
 *
 * `name` = brand display name (z. B. "AutohausPro", "vereinsfux").
 * `label` = Tag/Untertitel im Brand-Block (z. B. "SuperAdmin").
 * `version` = App-Version-String (Build-Info).
 * `icon` = 2-stelliges Kürzel für das Logo-Badge (z. B. "ah", "vf").
 * `logoUrl` = optionale URL zu PNG/SVG; wenn gesetzt, rendert die UI ein <img>
 *             statt des Initialen-Badges.
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
    /** App-Identity (Branding + Version), s. PlanCatalogApp. Optional. */
    app?: PlanCatalogApp;
    /** ISO-4217-Währungscode. */
    currency: string;
    /** USt-Satz in Prozent. */
    vatRate: number;
    /** App-weite Marketing-Konfiguration (SPEC_V2 §6.5). Optional. */
    marketing?: PlanCatalogMarketing;
    quotaKeys: QuotaKey[];
    features?: FeatureDef[];
    /**
     * Optional. Wenn weggelassen, kommen Plans ausschließlich aus dem
     * AdminUI / DB-Tabelle (Plans-/PlanVersions-Lifecycle).
     */
    plans?: PlanDef[];
}

// AUTO-GENERATED — nicht manuell editieren.
//
// Quelle: @saasicat/spec/schemas/plan-catalog.schema.json
// Regenerieren: `pnpm --filter @saasicat/types gen:types`
// Drift-Gate: tests/codegen-drift.test.js bricht den PR, wenn Schema und
// generierter Output auseinanderlaufen.

/**
 * Sprach-neutrale Definition eines Plan-Catalogs + App-Identity für eine SaaS-App. Wird vom Konsumenten als YAML-/JSON-Datei (`config/saas.yaml`) gepflegt und beim Backend-Boot in Plattform-Tabellen gespiegelt.
 */
export interface PlanCatalog {
    schemaVersion: 1;
    /**
     * Eindeutiger Schlüssel des konsumierenden Projekts. Cross-Audit-Marker.
     */
    projectKey: string;
    /**
     * App-Identity-Block (Branding + Version). Vom AdminPublicBootController + AdminManifestConfigFactory konsumiert.
     */
    app?: {
        /**
         * Brand-Display-Name (z. B. "My App").
         */
        name: string;
        /**
         * Tag/Untertitel im Brand-Block (z. B. "SuperAdmin").
         */
        label?: string;
        /**
         * App-Version-String (Build-Info).
         */
        version?: string;
        /**
         * Kurz-Kürzel für das Logo-Badge (z. B. "cf", "vf").
         */
        icon?: string;
        /**
         * Optionale URL zu PNG/SVG; wenn gesetzt, rendert die UI ein <img> statt des Initialen-Badges.
         */
        logoUrl?: string;
    };
    /**
     * ISO-4217-Währungscode. EUR-only in Phase 1.
     */
    currency: string;
    /**
     * USt-Satz in Prozent. Pflicht (auch bei 0).
     */
    vatRate: number;
    /**
     * App-weite Marketing-Konfiguration. SPEC_V2 §6.5.
     */
    marketing?: {
        /**
         * Erlaubter Sprach-Pool, den die App vermarkten darf. Erste = Default-Locale. Der SuperAdmin aktiviert daraus im Marketing-Catalog eine Teilmenge (LocaleManager).
         *
         * @minItems 1
         */
        availableLocales: [string, ...string[]];
    };
    /**
     * Master-Liste aller Feature-Flags des Projekts. Pläne dürfen nur hier deklarierte Keys referenzieren.
     */
    features?: FeatureDef[];
    /**
     * Optional. Wenn weggelassen, kommen Plans ausschließlich aus dem AdminUI / DB.
     */
    plans?: PlanDef[];
}
export interface FeatureDef {
    /**
     * SCREAMING_SNAKE_CASE; eindeutig pro Catalog.
     */
    key: string;
    label?: string;
    icon?: string;
    /**
     * Optionale logische Gruppe. Konvention: CORE / ADVANCED / PRO / BUSINESS / ENTERPRISE_ONLY.
     */
    tier?: string;
    /**
     * Markiert, dass das Feature nicht produktiv ist (kein Plan oder Bundle referenziert es).
     */
    plannedOnly?: boolean;
}
export interface PlanDef {
    /**
     * Plan-ID. Vom Konsumenten frei wählbar (BASIC, STANDARD, ...). Landet als String in Subscription.plan.
     */
    id: string;
    name?: string;
    tagline?: string;
    /**
     * false = nicht im Self-Service-Onboarding wählbar (z. B. ENTERPRISE).
     */
    marketed?: boolean;
    /**
     * Highlighted-Karte im Onboarding (max. 1 pro Catalog).
     */
    popular?: boolean;
    /**
     * Netto-Monatspreis. null = auf Anfrage (Sales-Kontakt).
     */
    monthlyNet?: number | null;
    /**
     * Netto-Gesamt­betrag pro Jahr bei BillingCycle=YEARLY (nicht effektiver Monatspreis). null = nur monatlich.
     */
    yearlyNet?: number | null;
    quotas: {
        /**
         * -1 = unbegrenzt; 0 = nicht erlaubt; >0 = harte Obergrenze.
         *
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[a-z][A-Za-z0-9]*$".
         */
        [k: string]: number;
    };
    /**
     * Liste der enthaltenen Feature-Keys; alle müssen in features[].key existieren.
     */
    features: string[];
}

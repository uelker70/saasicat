// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/plan-catalog.schema.json
// Regenerate: `pnpm --filter @saasicat/types gen:types`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.

/**
 * Language-neutral definition of a plan catalog + app identity for a SaaS app. Maintained by the consumer as a YAML/JSON file (`config/saas.yaml`) and mirrored into platform tables at backend boot.
 */
export interface PlanCatalog {
    schemaVersion: 1;
    /**
     * Unique key of the consuming project. Cross-audit marker.
     */
    projectKey: string;
    /**
     * App identity block (branding + version). Consumed by AdminPublicBootController + AdminManifestConfigFactory.
     */
    app?: {
        /**
         * Brand display name (e.g. "My App").
         */
        name: string;
        /**
         * Tag/subtitle in the brand block (e.g. "SuperAdmin").
         */
        label?: string;
        /**
         * App version string (build info).
         */
        version?: string;
        /**
         * Short abbreviation for the logo badge (e.g. "ma", "da").
         */
        icon?: string;
        /**
         * Optional URL to PNG/SVG; when set, the UI renders an <img> instead of the initials badge.
         */
        logoUrl?: string;
    };
    /**
     * ISO 4217 currency code. EUR-only in phase 1.
     */
    currency: string;
    /**
     * VAT rate in percent. Required (even when 0).
     */
    vatRate: number;
    /**
     * App-wide marketing configuration. SPEC_V2 §6.5.
     */
    marketing?: {
        /**
         * Allowed language pool the app may market. First = default locale. From it the SuperAdmin activates a subset in the marketing catalog (LocaleManager).
         *
         * @minItems 1
         */
        availableLocales: [string, ...string[]];
    };
    /**
     * Master list of all feature flags of the project. Plans may only reference keys declared here.
     */
    features?: FeatureDef[];
    /**
     * Optional. When omitted, plans come exclusively from the AdminUI / DB.
     */
    plans?: PlanDef[];
}
export interface FeatureDef {
    /**
     * SCREAMING_SNAKE_CASE; unique per catalog.
     */
    key: string;
    label?: string;
    icon?: string;
    /**
     * Optional logical group. Convention: CORE / ADVANCED / PRO / BUSINESS / ENTERPRISE_ONLY.
     */
    tier?: string;
    /**
     * Marks that the feature is not in production (no plan or bundle references it).
     */
    plannedOnly?: boolean;
}
export interface PlanDef {
    /**
     * Plan ID. Freely chosen by the consumer (BASIC, STANDARD, ...). Ends up as a string in Subscription.plan.
     */
    id: string;
    name?: string;
    tagline?: string;
    /**
     * false = not selectable in self-service onboarding (e.g. ENTERPRISE).
     */
    marketed?: boolean;
    /**
     * Highlighted card in onboarding (max. 1 per catalog).
     */
    popular?: boolean;
    /**
     * Net monthly price. null = on request (sales contact).
     */
    monthlyNet?: number | null;
    /**
     * Net total amount per year for BillingCycle=YEARLY (not the effective monthly price). null = monthly only.
     */
    yearlyNet?: number | null;
    quotas: {
        /**
         * -1 = unlimited; 0 = not allowed; >0 = hard upper limit.
         *
         * This interface was referenced by `undefined`'s JSON-Schema definition
         * via the `patternProperty` "^[a-z][A-Za-z0-9]*$".
         */
        [k: string]: number;
    };
    /**
     * List of included feature keys; all must exist in features[].key.
     */
    features: string[];
}

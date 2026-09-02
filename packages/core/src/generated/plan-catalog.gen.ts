// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/plan-catalog.schema.json
// Regenerate: `pnpm --filter @saasicat/core gen:types`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.

/**
 * Language-neutral definition of a plan catalog + app identity for a SaaS app. Maintained by the consumer as a YAML/JSON file (`config/saas.yaml`) and mirrored into platform tables at backend boot.
 */
export interface PlanCatalog {
    schemaVersion: 1;
    /**
     * App identity block (branding + version). One installation serves one application, so this is the only place it is named. Consumed by AdminPublicBootController + AdminManifestConfigFactory.
     */
    app: {
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
     * Commercial settings for the tenant-facing self-service routes. Required, and required member by member: every one of these has a money or a legal consequence, and a value left out is still a decision — just an invisible one. The file is read at boot, so a change lands on the next restart.
     */
    tenantBilling: {
        /**
         * Days of notice before a term ends, one number per rhythm. A cancellation declared after the window has closed takes effect at the first period end that actually serves the notice. Two numbers rather than one because a monthly and a yearly contract cannot share a notice period: a fortnight is unusual on a year, and three months is void against a consumer on a month. No ceiling is enforced — §309 Nr. 9 BGB caps it at one month in German consumer contracts, and an installation serving businesses is not bound by that.
         */
        cancellationNoticeDays: {
            /**
             * Notice days on a monthly rhythm. 0 means there is no door to be shut out of: a cancellation on the last day still lands at the term end.
             */
            monthly: number;
            /**
             * Notice days on a yearly rhythm. Raise it and the cut is hard — a declaration made after the window lands one full year later.
             */
            yearly: number;
        };
        /**
         * Plans a tenant may not move to or away from without talking to sales. Both lists are required and may be empty; an empty list is the explicit statement that self-service reaches every plan.
         */
        selfServiceBlockedPlans: {
            /**
             * Plan IDs that may not be selected via self-service — typically ENTERPRISE, which only a special contract activates.
             */
            asTarget: string[];
            /**
             * Plan IDs that may not be left via self-service — typically an active special contract, whose change goes through sales.
             */
            asSource: string[];
        };
    };
    /**
     * App-wide marketing configuration..
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
     * Who is told when something in this file changes between two starts. The record inside the application is written either way; mail is the addition, never the substitute. Optional: an installation of one operator who signs in daily needs nothing here.
     */
    notifications?: {
        /**
         * Addresses mailed when the settings applied at a start differ from the ones applied at the previous start. Mailed only where an email port is bound (`adapters.email`); without one the boot log says so once and the change is recorded in the application only. An empty list names nobody.
         */
        settingsChanged?: string[];
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

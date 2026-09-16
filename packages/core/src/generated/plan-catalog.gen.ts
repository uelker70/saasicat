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
     * VAT rate as a percentage: 19 means 19 %. Required (even when 0). Every tax rate in SaaSiCat is a percentage, so a value between 0 and 1, the shape of a fraction such as 0.19, is refused.
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
     * The legal entity on the operator's side of every contract this installation concludes, and later of every invoice it issues. A contract copies it on the day it is concluded, so the contract keeps naming its counterparty after this block changes. Optional for now: a contract concluded while it is absent records that no issuer was named.
     */
    issuer?: {
        /**
         * The registered name, legal form included, as a contract names the party (e.g. "Example Software GmbH"). Compared with the recorded one after the surrounding whitespace is taken off, so a value that is only whitespace is not a name at all.
         */
        legalName: string;
        /**
         * Street and number.
         */
        addressLine1?: string;
        /**
         * A second address line, such as a building or a c/o.
         */
        addressLine2?: string;
        postalCode?: string;
        city?: string;
        /**
         * ISO 3166-1 alpha-2 country code, e.g. DE.
         */
        country?: string;
        /**
         * VAT identification number, e.g. DE123456789.
         */
        vatId?: string;
        /**
         * The tax number the issuer's tax office assigned, where it is stated beside or instead of the VAT identification number.
         */
        taxNumber?: string;
        /**
         * Declares that a changed `legalName`, `vatId` or `taxNumber` corrects the same legal entity rather than naming another one -- a misspelt name, a tax identifier that was wrong or missing, a change of name the entity went through. Without it a start that finds a different identity recorded is refused while contracts concluded under the previous one still run, because moving a contract to another legal entity is a transfer and not an edit of a setting. Name here, for every identity field the change moves, the value the installation recorded before it -- `null` where it recorded none. The declaration is needed only for the start that carries the change; a later deploy may drop it. It carries no date of its own: the settings record dates the start that applied it, and where the legal change has a date of its own it belongs in `reason`.
         */
        correctionOf?: {
            /**
             * The registered name being replaced, or `null` where none was recorded.
             */
            legalName?: string | null;
            /**
             * The VAT identification number being replaced, or `null` where none was recorded.
             */
            vatId?: string | null;
            /**
             * The tax number being replaced, or `null` where none was recorded.
             */
            taxNumber?: string | null;
            /**
             * Why the same entity now reads differently, e.g. "Change of legal form, registered 2026-07-01". Kept in the settings record with both value trees.
             */
            reason: string;
        };
    };
    /**
     * How the parties this installation concludes contracts with are numbered.
     */
    subscribers?: {
        /**
         * Put in front of every customer number assigned from the next start on: `K-` gives K-10001. A customer number keeps the prefix it was assigned with, so changing this renumbers nobody. Omitted, a customer number is the number alone.
         */
        customerNumberPrefix?: string;
    };
    /**
     * The payment gateway accounts this installation takes payment methods through. SaaSiCat keeps the gateway's reference to a payment method and its masked details, never a card number or an IBAN. The keys and the webhook secret of each account are bound in the application's code from the environment and never written here.
     */
    payments?: {
        /**
         * The account a new payment method is taken at, at sign-up and when a tenant changes its payment method. It names one of `accounts`, which then has to list its `methods`. Omitted, no new payment method is taken, and the accounts listed stay for the references they hold.
         */
        newPaymentMethods?: string;
        /**
         * The origins a gateway's form may send a person back to, e.g. `https://app.example.com`: the scheme, the host and a port, no path. A sign-up or a tenant naming a success or cancel URL at any other origin is refused, so the operator's own payment form cannot be made to forward somebody to a page of a stranger's choosing.
         *
         * @minItems 1
         */
        returnUrlOrigins: [string, ...string[]];
        /**
         * Every gateway account by the name its webhook route carries: `/webhooks/payment/<name>`. An account that still holds a payment method in use stays listed after another takes the new ones, so its callbacks keep being handled; a start that finds a stored reference to an account missing here refuses, naming the account.
         */
        accounts: {
            [k: string]: PaymentGatewayAccount;
        };
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
/**
 * One account at a payment gateway: a merchant account whose keys the application binds.
 */
export interface PaymentGatewayAccount {
    /**
     * The gateway the account is at, as its adapter names itself: `stripe` for @saasicat/payment-stripe. A start refuses an account whose bound adapter names another.
     */
    provider: string;
    /**
     * The payment methods a new payment method may be at this account: `card`, `sepa_debit`. Required for the account `newPaymentMethods` names and read for no other.
     *
     * @minItems 1
     */
    methods?: ['card' | 'sepa_debit', ...('card' | 'sepa_debit')[]];
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

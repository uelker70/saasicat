// Shared types for platform dialogs. Extracted from the .vue files
// because vue-tsc does not support `type X from "...vue"`.

export interface PilotCreatePayload {
    tenant: { name: string; slug?: string; legalForm?: string; vatId?: string };
    admin: {
        email: string;
        firstName: string;
        lastName: string;
        initialPassword?: string;
    };
    pilot: { plan: string; note?: string; endsAt?: string };
}

export interface PilotCreateResult {
    slug: string;
    /** If the server generated an initial password, include it here. */
    initialPassword?: string;
}

/** Edit an existing pilot subscription (plan, end date, note). */
export interface PilotEditPayload {
    /** Optional — only the fields that are set get changed. */
    plan?: string;
    /** `null` clears the end date (open-ended pilot phase). */
    endsAt?: string | null;
    /** `null` or empty clears the note. */
    note?: string | null;
}

export interface PilotEditResult {
    slug: string;
    changed?: string[];
}

/**
 * Tenant-specific vocabulary for the pilot dialogs. The platform
 * provides neutral defaults ("Mandant"); consumers override with
 * their domain language (e.g. "Verein" or "Händler").
 */
export interface PilotCopy {
    /** Subtitle of the tenant section in the create dialog. */
    tenantSubtitle?: string;
    /** Label of the name field, e.g. "Vereinsname" / "Firmenname". */
    tenantNameLabel?: string;
    /** Placeholder for the tenant name. */
    tenantNamePlaceholder?: string;
    /** Placeholder for the slug. */
    slugPlaceholder?: string;
    /** Placeholder for the initial admin email. */
    adminEmailPlaceholder?: string;
    /** Placeholder for the internal note (create + edit). */
    notePlaceholder?: string;
}

/** Neutral, tenant-agnostic defaults for {@link PilotCopy}. */
export const DEFAULT_PILOT_COPY: Required<PilotCopy> = {
    tenantSubtitle: 'Stammdaten des Mandanten',
    tenantNameLabel: 'Name des Mandanten',
    tenantNamePlaceholder: 'z. B. Muster GmbH',
    slugPlaceholder: 'muster-mandant',
    adminEmailPlaceholder: 'admin@example.com',
    notePlaceholder: 'z. B. Sales-Pilot · Demo-Zugang',
};

export type PromoCodeValueType = 'PERCENT' | 'ABSOLUTE';
export type PromoCodeDurationType = 'ONCE' | 'MONTHS' | 'BILLING_CYCLES';

export interface PromoCodeCreatePayload {
    code: string;
    valueType: PromoCodeValueType;
    value: number;
    durationType: PromoCodeDurationType;
    durationValue: number | null;
    maxRedemptions: number | null;
    validFrom: string | null;
    validUntil: string | null;
    /** Plan keys the code applies to. Empty = all plans. */
    appliesToPlans?: string[];
    /** Optional: filter on MONTHLY/YEARLY subscriptions. */
    appliesToBilling?: 'MONTHLY' | 'YEARLY';
    /** Only redeemable by new customers. */
    firstTimeCustomersOnly?: boolean;
    /** Minimum gross plan amount from which the code takes effect. */
    minimumPlanAmountGross?: number;
    /** Allows €0 invoices (otherwise the discount is capped at 100% of the amount). */
    allowZeroInvoice?: boolean;
    /** Ledger account for discount revenue reduction (app-specific). */
    revenueDeductionAccount?: string;
    campaignTag?: string;
    description?: string;
}

/** Plan option for the plan picker in PromoCodeCreateDialog. */
export interface PromoCodePlanOption {
    /** Plan key as sent to the backend (e.g. 'BASIC'). */
    key: string;
    /** Display label (e.g. 'Basic'). */
    label: string;
    /** Optional accent for the plan chip; fallback neutral gray. */
    color?: string;
}

/**
 * PATCH payload — all fields optional, only the explicitly set ones
 * are sent to the backend (whitelist on the server side). `code` is
 * not in the list because it stays stable after creation.
 */
export interface PromoCodeUpdatePayload {
    status?: 'ACTIVE' | 'PAUSED';
    valueType?: PromoCodeValueType;
    value?: number;
    durationType?: PromoCodeDurationType;
    durationValue?: number | null;
    maxRedemptions?: number | null;
    validFrom?: string | null;
    validUntil?: string | null;
    appliesToPlans?: string[];
    appliesToBilling?: 'MONTHLY' | 'YEARLY' | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | null;
    allowZeroInvoice?: boolean;
    description?: string | null;
    campaignTag?: string | null;
    revenueDeductionAccount?: string | null;
}

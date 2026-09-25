// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/subscriber-ledger.schema.json
// Regenerate: `pnpm --filter @saasicat/core gen:types`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.

/**
 * What made the charge arise. activation: the first period of a subscription. renewal: a later period. planChange: what an immediate plan change adds. bundleBooking: the first, short period of an add-on. credit: a decision that reduces what is owed. correction: a counter-entry reversing an earlier charge, which is how the append-only journal answers a mistake.
 */
export type SubscriberChargeOrigin =
    'activation' | 'renewal' | 'planChange' | 'bundleBooking' | 'credit' | 'correction';
/**
 * Which kind of contract line the charge realises.
 */
export type SubscriberChargeSource = 'plan' | 'bundle' | 'discount';

/**
 * One charge in a subscriber's account: an amount that became due for a period, derived from a line of the contract in force. The journal is append-only — a charge is never updated, and a mistake is answered with a counter-entry rather than an edit, so the account says what happened rather than what somebody thinks today. A charge is net: the tax is decided by the tax adapter when the charge is invoiced, from the subscriber's origin on that day, and computed once per rate on the invoice.
 */
export interface SubscriberCharge {
    /**
     * The charge's own identifier. Never shown to a customer as an invoice number: invoice numbering is sequential, gapless and legally constrained per country, and an identifier somebody has already seen on a screen cannot become one later without confusion.
     */
    id: string;
    /**
     * The party the contract is concluded with, whose account this is. It outlives the tenant.
     */
    subscriberId: string;
    /**
     * The tenant the subscription belonged to when the charge arose.
     */
    tenantId: string;
    /**
     * The subscription the charge arose on. Part of the natural key.
     */
    subscriptionId: string;
    /**
     * The contract whose line the charge realises.
     */
    contractId: string;
    /**
     * The contract line the charge came from, so that every invoice line can be traced back to what was agreed.
     */
    contractLineItemId: string;
    origin: SubscriberChargeOrigin;
    source: SubscriberChargeSource;
    /**
     * Which thing of its source the charge is for, stable across contracts: the subscription id for the plan, the booking id for an add-on, the discount's key for a discount. Part of the natural key (subscriptionId, source, sourceRef, periodStart, origin), which is unique — a charge derived twice is written once.
     */
    sourceRef: string;
    /**
     * The start of the period the charge belongs to — the grouping key for an invoice.
     */
    periodStart: string;
    periodEnd: string;
    /**
     * ISO 4217, as the contract line records it — recorded per charge so that a charge written in 2026 still means what it meant after the configured currency changes.
     */
    currency: string;
    /**
     * Net, rounded to the currency's decimal places once, when the charge is written; the written figure is the truth from then on. Negative for a discount.
     */
    amountNet: number;
    /**
     * When the amount became due. The account is ordered by this, not by when the row was written.
     */
    bookedAt: string;
    createdAt: string;
}

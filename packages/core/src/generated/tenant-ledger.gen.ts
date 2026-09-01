// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/tenant-ledger.schema.json
// Regenerate: `pnpm --filter @saasicat/core gen:types`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.

/**
 * One entry in a tenant's account. Two kinds share one journal: a charge is what became due, a payment is what settled part of it. The journal is append-only — an entry is never updated, and a mistake is answered with a counter-entry rather than an edit, so the account says what happened rather than what somebody thinks today.
 */
export type TenantLedgerEntry = LedgerCharge | LedgerPayment;
/**
 * What made the charge arise. activation: the first period of a subscription. renewal: a period renewing. planChange: the prorated difference of an immediate plan change. bundleBooking: an add-on booked. credit: a decision that reduces what is owed. correction: a counter-entry reversing an earlier one, which is how the append-only journal answers a mistake.
 */
export type ChargeOrigin =
    'activation' | 'renewal' | 'planChange' | 'bundleBooking' | 'credit' | 'correction';
/**
 * ISO 4217. Recorded per entry even though an installation configures one at a time, so that a row written in 2026 still means what it meant after the configured currency changes.
 */
export type Currency = string;

/**
 * An amount that became due. It names the period it belongs to, so the charges that make up one invoice can be found later, and it names the agreement it came from, so it can be walked back to what the tenant agreed to.
 */
export interface LedgerCharge {
    /**
     * The entry's own identifier. Never shown to a customer as an invoice number: invoice numbering is sequential, gapless and legally constrained per country, and an identifier somebody has already seen on a screen cannot become one later without confusion.
     */
    id: string;
    tenantId: string;
    kind: 'charge';
    /**
     * The subscription the charge arose on. Part of the natural key below.
     */
    subscriptionId: string;
    origin: ChargeOrigin;
    /**
     * Which thing within the origin the charge is for, so that two charges of the same origin in the same period stay apart. activation and renewal: the subscription id. planChange: the id of the contract the change concluded, which differs for every change. bundleBooking: the booking id. credit and correction: the entry they answer. Never empty — the natural key (subscriptionId, origin, originRef, periodStart) is unique, and a NULL would not collide with itself, which is the one thing the key exists to prevent.
     */
    originRef: string;
    /**
     * The billing period the charge belongs to. It is the grouping key for a later invoice: a set of individually booked amounts with nothing tying them to a period leaves 'which charges go on one invoice' to guesswork.
     */
    periodStart: string;
    periodEnd: string;
    /**
     * The frozen agreement the charge realises. Null where none was frozen — a subscription older than the contract model, or a credit that answers no line.
     */
    contractId?: string | null;
    /**
     * The contract line the charge came from. Null under the same conditions as contractId.
     */
    contractLineItemId?: string | null;
    currency: Currency;
    /**
     * Held to the currency's decimal places. Negative on a credit or a correction.
     */
    amountNet: number;
    /**
     * The rate in percent, recorded rather than left to live in the ratio between net and gross. A ratio cannot be reproduced for a rounded gross, cannot express an exempt or reverse-charge line, and does not survive a rate change.
     */
    taxRate: number;
    /**
     * The tax contained in the charge. It closes the gap between amountNet and amountGross exactly, so the entry cannot disagree with itself.
     */
    taxAmount: number;
    amountGross: number;
    /**
     * When the amount became due. The account is ordered by this, not by when the row was written.
     */
    bookedAt: string;
    createdAt: string;
}
/**
 * An amount that settled. What talks to a bank, a card processor or an invoice run is a consumer's adapter behind a port; this records only that the money arrived and which external reference it arrived under. It carries no tax split: a payment is a movement of money, and the net, the rate and the tax belong to the charges it settles — asking a payment for them would make an integrator write a number nobody knows, which the account would then read as a fact.
 */
export interface LedgerPayment {
    id: string;
    tenantId: string;
    kind: 'payment';
    /**
     * The payment provider's own identifier for the settlement. It is what makes a payment reconcilable against the provider, and what a second delivery of the same provider event is recognised by.
     */
    externalReference: string;
    /**
     * The charge this payment settles, where the provider says which. Null for a payment on account, which reduces the balance without naming a charge.
     */
    settlesEntryId?: string | null;
    currency: Currency;
    /**
     * What arrived. Negative on a reversal, which is a movement the other way rather than an edit of the payment it answers.
     */
    amountGross: number;
    /**
     * The value date — when the money settled, which is not when the row was written.
     */
    bookedAt: string;
    createdAt: string;
}

/**
 * charge: an amount became due. payment: an amount settled.
 */
export type LedgerEntryKind = 'charge' | 'payment';

/**
 * A charge that is not yet settled in full.
 */
export interface TenantAccountOpenItem {
    entryId: string;
    origin: ChargeOrigin;
    periodStart: string;
    periodEnd: string;
    currency: Currency;
    amountGross: number;
    /**
     * What payments naming this charge have settled so far.
     */
    settledGross: number;
    /**
     * amountGross minus settledGross.
     */
    openGross: number;
    dueAt: string;
}

/**
 * What a tenant and an administrator both read: the balance, what is open, and the history. One shape for both, because a balance a tenant is shown and a balance an administrator is shown must not be two answers.
 */
export interface TenantAccount {
    tenantId: string;
    currency: Currency;
    /**
     * A balance is only ever true at a moment, and this is the moment.
     */
    asOf: string;
    chargedGross: number;
    paidGross: number;
    /**
     * chargedGross minus paidGross. Positive means the tenant owes; negative means they have paid ahead.
     */
    balanceGross: number;
    openItems: TenantAccountOpenItem[];
    /**
     * The history the read was asked for, newest first. The window is the caller's decision, not a property of the account.
     */
    entries: (LedgerCharge | LedgerPayment)[];
}

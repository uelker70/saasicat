// SubscriberCharge — one charge in a subscriber's account.
// Wire format: @saasicat/spec/schemas/subscriber-ledger.schema.json, from which
// the origin and source unions are generated.

import type {
    SubscriberCharge,
    SubscriberChargeOrigin,
    SubscriberChargeSource,
} from './generated/subscriber-ledger.gen.js';

export type {
    SubscriberCharge,
    SubscriberChargeOrigin,
    SubscriberChargeSource,
} from './generated/subscriber-ledger.gen.js';

/** A charge as a store reads it back: the wire format, with its dates as dates. */
export interface SubscriberChargeRecord {
    id: string;
    subscriberId: string;
    tenantId: string;
    subscriptionId: string;
    contractId: string;
    contractLineItemId: string;
    origin: SubscriberChargeOrigin;
    source: SubscriberChargeSource;
    /** The subscription id for the plan, the booking id for an add-on, the discount's key. */
    sourceRef: string;
    periodStart: Date;
    periodEnd: Date;
    currency: string;
    /** Net, rounded to the cent when written. Negative for a discount. */
    amountNet: number;
    /** When the amount became due. */
    bookedAt: Date;
    createdAt: Date;
}

/** A charge to write: everything but what the store assigns. */
export type NewSubscriberCharge = Omit<SubscriberChargeRecord, 'id' | 'createdAt'>;

/**
 * The manifest capability that announces the operator's view of an account.
 * The platform sets it where it serves the view, and the admin UI shows the
 * view only where it is set.
 */
export const SUBSCRIBER_ACCOUNT_CAPABILITY = 'charges.read';

/** Whose account it is, as the operator is shown it. */
export interface AdminAccountHolder {
    id: string;
    /** What the customer quotes, and what an invoice will carry. */
    customerNumber: string;
    legalName: string;
}

/** One charge of an account, with the name its contract line gives it. */
export interface AdminAccountEntry {
    /** The charge as the journal holds it. */
    charge: SubscriberCharge;
    /**
     * The contract line's own title, as it was when the contract was
     * concluded, or `null` where that line cannot be read.
     */
    title: string | null;
}

/**
 * A tenant's account as the operator reads it: the charges of the subscription
 * it holds, newest first — by when each became due, then by its period, then
 * the plan before its add-ons before its discounts.
 *
 * No total: without invoices and payments, a sum would be what was charged so
 * far, and it would be read as what is owed.
 */
export interface AdminSubscriberAccount {
    /** `null` for a tenant that has no subscriber. */
    holder: AdminAccountHolder | null;
    entries: AdminAccountEntry[];
}

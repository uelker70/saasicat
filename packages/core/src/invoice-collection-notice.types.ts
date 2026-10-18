// What a subscriber is told about collecting an invoice: that a collection
// failed and what follows, the day a direct debit is collected when it is
// announced again, and that a payment was reversed and its invoice is open
// again (`SC-PRIC-028`, `SC-PRIC-080`, `SC-PRIC-085`).
//
// Unlike a notice about a subscription's plan, which goes to the tenant's
// administrators, these go to the subscriber's invoice email — where the
// invoice and its first announcement went — through the invoice mail port.
// They are kept with the other notices, so each is sent once.

import type { CollectionFailureReason, PaymentMethodType } from './payment-gateway.types.js';
import type { CalendarDay } from './zoned-day.js';

/** What follows a failed collection. */
export type CollectionFailureNext =
    /** The same card, or the card now in use, is charged on `on`. */
    | { readonly action: 'charged-again'; readonly on: CalendarDay }
    /** A direct debit is announced again, with its own day, in a notice of its own. */
    | { readonly action: 'announced-again' }
    /** Nothing is tried again until the subscriber replaces the payment method. */
    | { readonly action: 'replace-payment-method' };

/** The invoice a collection notice is about, as it was issued. */
interface CollectionNoticeInvoice {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly subscriberId: string;
    readonly invoiceId: string;
    readonly invoiceNumber: string;
    /** What the invoice asks for, of `currency`. */
    readonly amount: number;
    readonly currency: string;
}

/** A collection failed. Told once per failed attempt. */
export interface CollectionFailedNotice extends CollectionNoticeInvoice {
    readonly kind: 'collection-failed';
    readonly paymentMethodType: PaymentMethodType;
    readonly reason: CollectionFailureReason;
    readonly next: CollectionFailureNext;
}

/**
 * A direct debit announced again, for a day of its own and under the mandate
 * of the payment method it is collected with. Told once per planned attempt;
 * it stands on its own and leaves the invoice as it was issued.
 */
export interface CollectionAnnouncedNotice extends CollectionNoticeInvoice {
    readonly kind: 'collection-announced';
    /** The day the account is debited. */
    readonly collectOn: CalendarDay;
    readonly mandateReference: string;
    /** The last four digits of the account's IBAN. */
    readonly last4: string;
}

/** What follows a reversal that opened an invoice again. */
export type CollectionReversedNext =
    /** It is collected with the payment method now in use, which replaced the reversed one. */
    | { readonly action: 'collected-with-payment-method-in-use' }
    /** Nothing is collected until the subscriber replaces the payment method. */
    | { readonly action: 'replace-payment-method' };

/**
 * A payment was reversed — a direct debit the bank returned, a chargeback —
 * and its invoice is open again. Told once per reversed attempt; nothing is
 * collected again with the payment method the payment was made with.
 */
export interface CollectionReversedNotice extends CollectionNoticeInvoice {
    readonly kind: 'collection-reversed';
    /** How the reversed payment was made. */
    readonly paymentMethodType: PaymentMethodType;
    /** What the invoice owes again, of `currency`. */
    readonly owed: number;
    readonly next: CollectionReversedNext;
}

/** A notice about collecting an invoice. */
export type InvoiceCollectionNotice =
    CollectionFailedNotice | CollectionAnnouncedNotice | CollectionReversedNotice;

// Canonical row -> record mapping for subscriber payment methods. Pure, and
// shared by both adapters for the reason `subscriber-mapping.ts` gives.

import type { PaymentMethodType } from './payment-gateway.types.js';
import type {
    RecordSubscriberPaymentMethodData,
    SubscriberPaymentMethodRecord,
    SubscriberPaymentMethodStatus,
} from './subscriber-payment-method.types.js';

/** The payment method types, in the order a form offers them. */
export const PAYMENT_METHOD_TYPES: readonly PaymentMethodType[] = ['card', 'sepa_debit'];

const STATUSES: readonly SubscriberPaymentMethodStatus[] = ['ACTIVE', 'REPLACED'];

/** A `subscriber_payment_methods` row as either adapter reads it back. */
export interface CanonicalSubscriberPaymentMethodRow {
    id: string;
    subscriberId: string;
    gatewayAccount: string;
    provider: string;
    customerRef: string;
    paymentMethodRef: string;
    type: string;
    brand: string | null;
    last4: string;
    expiryMonth: number | null;
    expiryYear: number | null;
    country: string | null;
    bankCode: string | null;
    mandateReference: string | null;
    status: string;
    confirmedAt: Date;
    replacedAt: Date | null;
    createdAt: Date;
}

/**
 * Reads a row back as a record.
 *
 * The two text columns with a closed set of values are checked rather than
 * cast: a value written by hand or by an older release would otherwise reach a
 * screen as a type nobody handles.
 */
export function toSubscriberPaymentMethodRecord(
    row: CanonicalSubscriberPaymentMethodRow,
): SubscriberPaymentMethodRecord {
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        gatewayAccount: row.gatewayAccount,
        provider: row.provider,
        customerRef: row.customerRef,
        paymentMethodRef: row.paymentMethodRef,
        type: oneOf(PAYMENT_METHOD_TYPES, row.type, 'type', row.id),
        brand: row.brand,
        last4: row.last4,
        expiryMonth: row.expiryMonth,
        expiryYear: row.expiryYear,
        country: row.country,
        bankCode: row.bankCode,
        mandateReference: row.mandateReference,
        status: oneOf(STATUSES, row.status, 'status', row.id),
        confirmedAt: row.confirmedAt,
        replacedAt: row.replacedAt,
        createdAt: row.createdAt,
    };
}

/** The columns a confirmed payment method is written with, and nothing a caller added beside them. */
export function subscriberPaymentMethodColumns(
    data: RecordSubscriberPaymentMethodData,
): Omit<CanonicalSubscriberPaymentMethodRow, 'id' | 'status' | 'replacedAt' | 'createdAt'> {
    return {
        subscriberId: data.subscriberId,
        gatewayAccount: data.gatewayAccount,
        provider: data.provider,
        customerRef: data.customerRef,
        paymentMethodRef: data.paymentMethodRef,
        type: data.type,
        brand: data.brand,
        last4: data.last4,
        expiryMonth: data.expiryMonth,
        expiryYear: data.expiryYear,
        country: data.country,
        bankCode: data.bankCode,
        mandateReference: data.mandateReference,
        confirmedAt: data.confirmedAt,
    };
}

function oneOf<T extends string>(
    allowed: readonly T[],
    value: string,
    column: string,
    id: string,
): T {
    const match = allowed.find((entry) => entry === value);
    if (match === undefined) {
        throw new Error(
            `subscriber_payment_methods row '${id}' holds ${column} '${value}', ` +
                `which is none of ${allowed.join(', ')}.`,
        );
    }
    return match;
}

/**
 * Refuses a reference of `gatewayAccount` that another subscriber holds.
 *
 * `(gatewayAccount, paymentMethodRef)` is unique account-wide rather than per
 * subscriber, so a read by reference reaches whichever subscriber holds it.
 * That key is also what makes the reference one subscriber's for good — the
 * second row cannot be written — and this is where the same boundary is drawn
 * for the read: a confirmation carrying a reference somebody else holds is
 * refused, rather than answered as the duplicate of a payment method that is
 * not this subscriber's. It is refused on a gateway callback, which arrives
 * without a session and with the tenant policy lifted, so nothing else there
 * bounds the question.
 *
 * That a provider issues a reference once per payer is a property of that
 * provider and no promise of this platform's, which is why the condition is
 * checked rather than assumed.
 *
 * The message names neither the subscriber that holds the reference nor the
 * tenant behind it: whoever reads the log of the refused confirmation is on
 * the other side of the boundary this refusal draws.
 */
export function refuseForeignPaymentMethodReference(
    recorded: Pick<
        CanonicalSubscriberPaymentMethodRow,
        'subscriberId' | 'gatewayAccount' | 'paymentMethodRef'
    >,
    subscriberId: string,
): void {
    if (recorded.subscriberId === subscriberId) return;
    throw foreignPaymentMethodReference(recorded.gatewayAccount, recorded.paymentMethodRef);
}

/**
 * The same refusal where the row cannot be read.
 *
 * Two confirmations for one subscriber take turns on the lock that
 * `recordConfirmed` holds, so the two that can reach the reference's unique key
 * at the same time belong to two subscribers — and the one that loses learns of
 * the other through the database rather than through a read. On PostgreSQL that
 * error has already aborted its transaction, so there is nothing left to read
 * with; an adapter turns what it caught into this.
 *
 * It costs nothing, because the sentence names no subscriber either way.
 */
export function foreignPaymentMethodReference(
    gatewayAccount: string,
    paymentMethodRef: string,
): Error {
    return new Error(
        `Payment method '${paymentMethodRef}' of account '${gatewayAccount}' ` +
            'belongs to another subscriber. A reference belongs to exactly one, so it is not handed out.',
    );
}

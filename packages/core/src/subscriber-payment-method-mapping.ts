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

/** Marks the refusal across module copies, the way `PaymentCallbackRejectedError` does. */
const FOREIGN_PAYMENT_METHOD_REFERENCE = 'FOREIGN_PAYMENT_METHOD_REFERENCE';

/**
 * A confirmation naming a reference that belongs to another subscriber.
 *
 * `(gatewayAccount, paymentMethodRef)` is unique account-wide rather than per
 * subscriber, and that is what makes the reference one subscriber's for good:
 * the second row cannot be written. This is the same boundary drawn for the
 * caller, so that a confirmation is refused rather than answered as the
 * duplicate of a payment method that is not this subscriber's — on a gateway
 * callback, which arrives without a session and with the tenant policy lifted,
 * so nothing else there bounds the question.
 *
 * That a provider issues a reference once per payer is a property of that
 * provider and no promise of this platform's, which is why the condition is
 * checked rather than assumed.
 *
 * It names neither the subscriber that holds the reference nor the tenant
 * behind it: whoever reads the log of the refused confirmation is on the other
 * side of the boundary this refusal draws. The account and the reference are
 * carried as fields so that a caller can say which confirmation was refused
 * without taking the sentence apart.
 */
export class ForeignPaymentMethodReferenceError extends Error {
    readonly code = FOREIGN_PAYMENT_METHOD_REFERENCE;
    constructor(
        readonly gatewayAccount: string,
        readonly paymentMethodRef: string,
    ) {
        super(
            `Payment method '${paymentMethodRef}' of account '${gatewayAccount}' ` +
                'belongs to another subscriber. A reference belongs to exactly one, so it is not handed out.',
        );
        this.name = 'ForeignPaymentMethodReferenceError';
    }
}

/** Realm-safe type guard, like `isPaymentCallbackRejectedError`. */
export function isForeignPaymentMethodReferenceError(
    error: unknown,
): error is ForeignPaymentMethodReferenceError {
    return (
        error instanceof Error &&
        (error as { code?: string }).code === FOREIGN_PAYMENT_METHOD_REFERENCE
    );
}

/**
 * Refuses a reference of `gatewayAccount` that another subscriber already
 * holds, where the row could be read.
 *
 * A write cannot rely on this alone: a read does not see a row a concurrent
 * transaction has not committed. What the reference's unique key refuses is
 * refused with the same error — see `SubscriberPaymentMethodRepository`.
 */
export function refuseForeignPaymentMethodReference(
    recorded: Pick<
        CanonicalSubscriberPaymentMethodRow,
        'subscriberId' | 'gatewayAccount' | 'paymentMethodRef'
    >,
    subscriberId: string,
): void {
    if (recorded.subscriberId === subscriberId) return;
    throw new ForeignPaymentMethodReferenceError(
        recorded.gatewayAccount,
        recorded.paymentMethodRef,
    );
}

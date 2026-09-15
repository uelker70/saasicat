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

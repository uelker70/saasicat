// Subscriber payment method — the gateway's reference to how a subscriber pays.
//
// A subscriber has one payment method in use at a time. A new one that the
// gateway confirms takes its place, and the one it replaced stays as history:
// a collection, a mandate reference or a dispute can still name it later.

import type { ConfirmedPaymentMethod } from './payment-gateway.types.js';

/** `ACTIVE` is the one in use; `REPLACED` is one a later payment method took over from. */
export type SubscriberPaymentMethodStatus = 'ACTIVE' | 'REPLACED';

export interface SubscriberPaymentMethodRecord extends ConfirmedPaymentMethod {
    id: string;
    subscriberId: string;
    /** The account in `config/saas.yaml#payments.accounts` the references belong to. */
    gatewayAccount: string;
    /** The provider of that account when the payment method was confirmed. */
    provider: string;
    status: SubscriberPaymentMethodStatus;
    /** When the gateway confirmed the payment method. */
    confirmedAt: Date;
    /** When a later payment method took over; `null` while this one is in use. */
    replacedAt: Date | null;
    createdAt: Date;
}

/** What a repository records for a payment method the gateway confirmed. */
export interface RecordSubscriberPaymentMethodData extends ConfirmedPaymentMethod {
    subscriberId: string;
    gatewayAccount: string;
    provider: string;
    confirmedAt: Date;
}

/**
 * - `activated`: it is the subscriber's payment method now, and the one it
 *   replaced, if any, is `REPLACED`.
 * - `already-recorded`: the account's reference was recorded before; nothing
 *   was written, and `method` is the row that holds it.
 * - `superseded`: the subscriber's payment method in use was confirmed after
 *   this one, so this one is recorded as already replaced — confirmations can
 *   arrive in another order than the forms were filled in.
 */
export type RecordSubscriberPaymentMethodOutcome = 'activated' | 'already-recorded' | 'superseded';

/**
 * A change of payment method a tenant started: the gateway session it opened
 * for the subscriber. A confirmation is recorded only against the setup it
 * belongs to, so a callback that names another subscriber than the session was
 * opened for changes nobody's payment method.
 */
export interface SubscriberPaymentMethodSetupData {
    subscriberId: string;
    gatewayAccount: string;
    /** The gateway's session, unique within the account. */
    sessionRef: string;
    /** The customer the gateway keeps the payment method under. */
    customerRef: string;
    startedAt: Date;
}

/** Which setup a confirmation claims to complete. */
export interface SubscriberPaymentMethodSetupMatch {
    gatewayAccount: string;
    sessionRef: string;
    subscriberId: string;
}

/**
 * Which payment method a read by reference asks about.
 *
 * All three together, because `(gatewayAccount, paymentMethodRef)` is unique
 * account-wide rather than per subscriber: without the subscriber the question
 * has no answer that is this caller's.
 *
 * One argument rather than three strings in a row, for the reason
 * `SubscriberPaymentMethodSetupMatch` is one — at a call site three strings of
 * the same type can be swapped with nothing saying so — and for a second that
 * is specific to a port. `TransactionContext` is `unknown`, so it accepts a
 * string: against a positional signature, an implementation whose parameters
 * are offset by one typechecks and then reads the account out of the
 * subscriber's place. Against an object it does not.
 */
export interface SubscriberPaymentMethodReference {
    subscriberId: string;
    gatewayAccount: string;
    paymentMethodRef: string;
}

export interface RecordSubscriberPaymentMethodResult {
    method: SubscriberPaymentMethodRecord;
    outcome: RecordSubscriberPaymentMethodOutcome;
}

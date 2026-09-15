import type { TransactionContext } from './core-ports.types.js';
import type { PaymentGatewayEvent } from '../payment-gateway.types.js';
import type {
    RecordSubscriberPaymentMethodData,
    RecordSubscriberPaymentMethodResult,
    SubscriberPaymentMethodRecord,
} from '../subscriber-payment-method.types.js';

// =============================================================================
// Payments — the record of gateway callbacks, and the payment methods they confirm
// =============================================================================

/** A gateway event, as the log records it. */
export interface PaymentEventClaim {
    /** The account the event came from; an event identifier is unique only within it. */
    gatewayAccount: string;
    eventId: string;
    provider: string;
    /** The gateway session the event is about, where it is about one. */
    sessionId: string | null;
    kind: PaymentGatewayEvent['kind'];
    /** What the event said, without anything that names or reaches a person. */
    summary: Record<string, unknown>;
}

/**
 * The events a gateway sent, each handled once.
 *
 * Gateways deliver at least once, so the same event arrives again after a
 * timeout or a retry. An event is claimed on the transaction that writes what
 * it changes: when that transaction rolls back, the claim goes with it and the
 * gateway's retry is handled rather than discarded as a duplicate.
 */
export interface PaymentEventLog {
    /**
     * Records the event and returns `true`, or returns `false` when this account
     * already recorded it, writing nothing.
     *
     * The duplicate must not raise: on PostgreSQL an error aborts the
     * transaction it happened on, and the caller's transaction has to stay
     * usable. An `INSERT … ON CONFLICT DO NOTHING` does both — and when another
     * transaction holds the same claim uncommitted, it waits for that one and
     * answers by its outcome.
     */
    claim(claim: PaymentEventClaim, tx: TransactionContext): Promise<boolean>;
}

/**
 * The payment methods of subscribers, as references at the gateway accounts
 * that confirmed them.
 *
 * A subscriber has at most one `ACTIVE` payment method; the database holds
 * that, so two confirmations recorded at once for one subscriber end with one.
 */
export interface SubscriberPaymentMethodRepository {
    /**
     * Records a confirmed payment method for its subscriber, under a lock on the
     * subscriber so two confirmations take turns. See
     * `RecordSubscriberPaymentMethodOutcome` for the three outcomes.
     */
    recordConfirmed(
        data: RecordSubscriberPaymentMethodData,
        tx?: TransactionContext,
    ): Promise<RecordSubscriberPaymentMethodResult>;
    /** The subscriber's payment method in use, or `null` when it has none. */
    findActive(
        subscriberId: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentMethodRecord | null>;
    /** The payment method an account's reference names, whatever its status. */
    findByReference(
        gatewayAccount: string,
        paymentMethodRef: string,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentMethodRecord | null>;
    /** Every account that holds a payment method in use, each once. */
    accountsInUse(): Promise<string[]>;
}

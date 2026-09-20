import type { TransactionContext } from './core-ports.types.js';
import type { PaymentGatewayEvent } from '../payment-gateway.types.js';
import type {
    RecordSubscriberPaymentMethodData,
    RecordSubscriberPaymentMethodResult,
    SubscriberPaymentMethodRecord,
    SubscriberPaymentMethodReference,
    SubscriberPaymentMethodSetupData,
    SubscriberPaymentMethodSetupMatch,
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
     *
     * A confirmation of a session this account already confirmed is a duplicate
     * as well, whatever its `eventId`: one session is set up once, and a gateway
     * may report it through more than one event. `sql/constraints.postgres.sql`
     * holds that as a second unique index, and the untargeted `DO NOTHING`
     * answers for it too.
     */
    claim(claim: PaymentEventClaim, tx: TransactionContext): Promise<boolean>;
    /**
     * Takes the session off a claim whose event changed nothing, so the next
     * event about that session is handled instead of taken for the duplicate it
     * is not. The claim itself stays: that one event is never handled twice.
     *
     * The session is held from the claim onwards, which is what keeps two
     * confirmations delivered at once from both taking effect; an event that
     * turned out to have nothing to do gives it back on the same transaction.
     */
    releaseSession(gatewayAccount: string, eventId: string, tx: TransactionContext): Promise<void>;
}

/**
 * The payment methods of subscribers, as references at the gateway accounts
 * that confirmed them.
 *
 * A subscriber has at most one `ACTIVE` payment method; the database holds
 * that, so two confirmations recorded at once for one subscriber end with one.
 *
 * **Within an account, a reference belongs to exactly one subscriber**, and
 * keeps belonging to it once a newer payment method has replaced it. Every
 * method that reaches a payment method therefore names the subscriber it is
 * about, and an implementation answers about that one only. `accountsInUse` is
 * the exception and says so at itself: it counts accounts rather than handing
 * out a row.
 *
 * That matters on a gateway callback, which is where these are reached: it
 * arrives without a session, so an installation that keeps its tenants apart
 * with a policy lifts that policy for it, and what the question names is then
 * all that bounds it.
 */
export interface SubscriberPaymentMethodRepository {
    /**
     * Records a confirmed payment method for its subscriber, under a lock on the
     * subscriber so two confirmations take turns. See
     * `RecordSubscriberPaymentMethodOutcome` for the three outcomes.
     *
     * A confirmation carrying a reference **another** subscriber holds is a
     * fourth case and has no outcome: it is refused, because the account's
     * reference is that subscriber's and answering `already-recorded` would
     * hand its payment method to a caller acting for somebody else.
     * `refuseForeignPaymentMethodReference` is the refusal, so every
     * implementation gives it in the same words.
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
    /**
     * The payment method the reference names, whatever its status — and `null`
     * when that subscriber holds none under it, which includes the case of
     * another subscriber holding the reference.
     *
     * The one read that reaches a payment method a newer one replaced, which is
     * how `@saasicat/persistence-testing` verifies that an implementation keeps
     * the history rather than overwriting the row (`SC-PRIC-030`).
     *
     * The subscriber is what bounds the read. Without it an implementation
     * would have only the account's reference to go on, which is unique
     * account-wide: inside a tenant's context a policy would answer `null` and
     * on a gateway callback, where that policy is lifted, the same call would
     * answer with somebody else's row. One question, two answers by where it
     * was asked, is what naming the subscriber removes.
     */
    findByReference(
        reference: SubscriberPaymentMethodReference,
        tx?: TransactionContext,
    ): Promise<SubscriberPaymentMethodRecord | null>;
    /**
     * Every account that holds a payment method in use, each once.
     *
     * Platform-wide: anchored by no subscriber and no tenant, and a start makes
     * it before anything is served, to refuse a configuration that no longer
     * names an account somebody's payment method is held at. An implementation
     * on a tenant-scoped client must read RLS-exempt — the platform wraps the
     * call in `RlsBypassPort`, and one that answers with the caller's tenant
     * scope instead returns an empty list at a boot, where there is no tenant,
     * so the check that exists to refuse passes. The persistence contract runs
     * with no policy forced, so it cannot catch that for you.
     */
    accountsInUse(): Promise<string[]>;
    /**
     * Records a change of payment method a tenant started, open until its
     * confirmation completes it.
     *
     * One session is one setup: the account and the session are unique together,
     * and a second setup for a session already recorded raises. A gateway hands
     * out a session per start, so an adapter that returns one twice is the
     * defect this refuses to write over.
     */
    recordSetup(data: SubscriberPaymentMethodSetupData, tx?: TransactionContext): Promise<void>;
    /**
     * Completes the open setup the account, the session and the subscriber all
     * name, and returns `true` — or returns `false`, writing nothing, when no
     * open setup matches all three: none was started, it was started for another
     * subscriber, or it is complete already. A single conditional write, so two
     * confirmations for one setup complete it once.
     */
    completeSetup(
        match: SubscriberPaymentMethodSetupMatch,
        completedAt: Date,
        tx?: TransactionContext,
    ): Promise<boolean>;
}

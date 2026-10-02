// The ports behind subscriber notices: where the record of each notice is
// kept, and how the application sends one.

import type {
    SubscriptionNotice,
    SubscriptionNoticeDelivery,
    SubscriptionNoticeKey,
    SubscriptionNoticeKind,
    SubscriptionNoticeRecord,
} from '../subscription-notice.types.js';
import type { TransactionContext } from './core-ports.types.js';

/** A notice to record before anybody is told: its key and what it says. */
export interface NoticeToRecord extends SubscriptionNoticeKey {
    readonly content: unknown;
}

/**
 * Keeps the record of every notice sent to a subscriber: one per subscription,
 * kind and subject, with when and to whom it went.
 *
 * Delivery takes three writes so that a notice is sent once even where several
 * instances run the same job: a run claims the notice, the application sends
 * it, and the run confirms it — or releases it where the sending failed, for the
 * next run to try again. Each write is conditional on what the caller read; an
 * adapter translates and does not decide.
 */
export interface SubscriptionNoticeRepository {
    /**
     * Records the notice named by `key` where it is not recorded yet, and
     * claims it for this run: where it is not delivered and no run holds it,
     * or the run that holds it took it on before `staleBefore`. A claim stores
     * `content` as what the notice says. Returns the notice as claimed, or null
     * where it is delivered or another run holds a fresh claim — of two
     * concurrent calls exactly one claims it.
     */
    claim(
        key: SubscriptionNoticeKey,
        content: unknown,
        now: Date,
        staleBefore: Date,
    ): Promise<SubscriptionNoticeRecord | null>;
    /**
     * Records the notice `id` as delivered, provided it is still held by the
     * claim taken at `claimedAt` and not delivered. Returns false where it is
     * not: the claim went stale and another run took the notice on.
     */
    confirm(
        id: string,
        claimedAt: Date,
        delivery: SubscriptionNoticeDelivery,
        now: Date,
    ): Promise<boolean>;
    /**
     * Lets go of the claim taken at `claimedAt`, so the next run tries again.
     * Does nothing where the notice is delivered or held by another claim.
     */
    release(id: string, claimedAt: Date): Promise<void>;
    /** The subscriptions a notice of `kind` about `subject` has been delivered to. */
    listDeliveredSubscriptionIds(kind: SubscriptionNoticeKind, subject: string): Promise<string[]>;
    /** Every notice of one subscription, the most recently recorded first. */
    listForSubscription(subscriptionId: string): Promise<SubscriptionNoticeRecord[]>;
    /**
     * Records each notice where it is not recorded yet, unclaimed and not
     * delivered — in the caller's transaction where one is given, so a notice
     * exists exactly when what it tells of does. A notice already recorded
     * under the same key is left as it is and not counted: the answer is how
     * many were recorded now, so a caller can tell that another got there
     * first — under a transaction running beside it as well.
     */
    record(notices: readonly NoticeToRecord[], now: Date, tx?: TransactionContext): Promise<number>;
    /** Every notice of `kind` recorded at or after `since`, the most recent first. */
    listOfKindSince(kind: SubscriptionNoticeKind, since: Date): Promise<SubscriptionNoticeRecord[]>;
    /**
     * The notices of `kind` that are not delivered and that no run holds — never
     * claimed, released, or claimed before `staleBefore` — the oldest first.
     */
    listUndelivered(
        kind: SubscriptionNoticeKind,
        staleBefore: Date,
    ): Promise<SubscriptionNoticeRecord[]>;
}

/**
 * Sends a notice to the administrators of the tenant it is for, in the
 * application's words and through its channels. The platform decides when a
 * notice is due; who the administrators are, what the message says and how it
 * travels are the application's.
 *
 * Resolve with who it went to and how — the platform keeps that as the record.
 * Throw where it could not be sent and should be tried again: the claim is
 * released and the next run sends it. Resolving with no recipients records that
 * nobody could be told, and the notice is not tried again.
 */
export interface SubscriptionNoticePort {
    deliver(notice: SubscriptionNotice): Promise<SubscriptionNoticeDelivery>;
}

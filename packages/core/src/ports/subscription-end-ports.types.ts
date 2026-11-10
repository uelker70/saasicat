// Where the end of each subscription is kept (`SC-CANC-027`).

import type { NewSubscriptionEnd, SubscriptionEnd } from '../subscription-end.types.js';

/**
 * Keeps one end per subscription that ended, in the application's own
 * database.
 *
 * An adapter translates. It does not decide whether a subscription ended or
 * which day its data goes; it keeps one row per subscription, so that a run
 * repeated, or two runs at once, record an end once.
 */
export interface SubscriptionEndPort {
    /**
     * Records `end` and returns it as stored — the id is the adapter's to
     * assign. Returns null where the subscription has an end already, which
     * is left as it was.
     */
    record(end: NewSubscriptionEnd): Promise<SubscriptionEnd | null>;
    /** The ends of those of `subscriptionIds` that have one, in one read. */
    listFor(subscriptionIds: readonly string[]): Promise<SubscriptionEnd[]>;
}

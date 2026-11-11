// Where the end of each subscription is kept (`SC-CANC-027`), and the day a
// tenant was told when it confirmed it.

import type {
    NewSubscriptionEnd,
    NewSubscriptionEndAnnouncement,
    SubscriptionEnd,
    SubscriptionEndAnnouncement,
} from '../subscription-end.types.js';

/**
 * Keeps one end per subscription that ended, and one announcement per
 * subscription whose cancellation was confirmed with a deletion day, in the
 * application's own database. The two are separate records: an announcement
 * is written when the cancellation is confirmed and says nothing about whether
 * it has landed; an end is written once it has, with the announced day where
 * there is one.
 *
 * An adapter translates. It does not decide whether a subscription ended or
 * which day its data goes; it keeps one row of each per subscription, so that
 * a run or a request repeated, or two at once, record each once.
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
    /**
     * Records `announcement` and returns it as stored — the id is the
     * adapter's to assign. Returns null where the subscription has an
     * announcement already, which is left as it was.
     */
    announce(
        announcement: NewSubscriptionEndAnnouncement,
    ): Promise<SubscriptionEndAnnouncement | null>;
    /** The announcements of those of `subscriptionIds` that have one, in one read. */
    listAnnouncedFor(subscriptionIds: readonly string[]): Promise<SubscriptionEndAnnouncement[]>;
}

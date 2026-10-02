// What a subscriber is told, and the record that they were.
//
// A notice goes to the administrators of the tenant a subscription belongs to,
// in the application's words and through its channels. The platform decides
// when one is due and keeps the record; the application says who it went to
// and how.

import type { VersionOfferView } from './version-offer.js';
import type {
    VersionRetiredNotice,
    VersionRetirementReminder,
} from './version-retirement.types.js';

/** What a notice is about. */
export type SubscriptionNoticeKind =
    'version-offered' | 'version-retired' | 'version-retirement-reminder';

/** Which notice: there is one per subscription, kind and subject. */
export interface SubscriptionNoticeKey {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly kind: SubscriptionNoticeKind;
    /**
     * What it is about. For `version-offered`, the id of the version offered;
     * for `version-retired`, the id of the version retired — so a subscription
     * is told of a version's retirement once, whichever announcement it came
     * with. The announcement is in the notice as `retirementId`. For
     * `version-retirement-reminder`, the id of the version retired as well: a
     * subscription is reminded of a version's retirement once.
     */
    readonly subject: string;
}

/** Who a notice went to and how, in the application's own terms. */
export interface SubscriptionNoticeDelivery {
    /** The addresses, or user ids, it was sent to. Empty where nobody could be told. */
    readonly recipients: readonly string[];
    /** The way it went — `email`, `in-app`, whatever the application calls it. */
    readonly channel: string;
}

/** A notice as it is kept. */
export interface SubscriptionNoticeRecord extends SubscriptionNoticeKey {
    readonly id: string;
    /** The notice as it was last handed to the application: a `SubscriptionNotice`. */
    readonly content: unknown;
    readonly createdAt: Date;
    /**
     * When a run took it on to deliver it. Null where no run holds it — before
     * the first attempt, and again after an attempt that failed.
     */
    readonly claimedAt: Date | null;
    /** When the application confirmed it sent it; null until then. */
    readonly deliveredAt: Date | null;
    /** Who it went to and how; set together with `deliveredAt`. */
    readonly delivery: SubscriptionNoticeDelivery | null;
}

/**
 * A newer version of the subscription's plan is now offered to it. Sent once
 * per version, when the offer appears beside the plan — the notice and the
 * offer say the same thing.
 */
export interface VersionOfferedNotice {
    readonly kind: 'version-offered';
    readonly tenantId: string;
    readonly subscriptionId: string;
    /** The offer as `GET billing/version-offer` answers it at the moment the notice is due. */
    readonly offer: VersionOfferView;
}

/** A notice handed to the application to send. */
export type SubscriptionNotice =
    VersionOfferedNotice | VersionRetiredNotice | VersionRetirementReminder;

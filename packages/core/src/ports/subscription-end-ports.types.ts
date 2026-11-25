// Where the end of each subscription is kept (`SC-CANC-027`), the day a tenant
// was told when it confirmed it, and each download of the tenant's export taken
// after it ended — and the port through which the application hands that
// export over.

import type {
    NewSubscriptionEnd,
    NewSubscriptionEndAnnouncement,
    NewTenantExportDownload,
    SubscriptionEnd,
    SubscriptionEndAnnouncement,
    TenantExportDownload,
} from '../subscription-end.types.js';
import type { TenantDataExport } from '../tenant-data-export.types.js';
import type { CalendarDay } from '../zoned-day.js';
import type { TransactionContext } from './core-ports.types.js';

/**
 * Keeps the end of each subscription that ended, and the announcement of each
 * subscription whose cancellation was confirmed with a deletion day, in the
 * application's own database. The two are separate records: an announcement
 * is written when the cancellation is confirmed and says nothing about whether
 * it has landed; an end is written once it has, with the announced day where
 * there is one.
 *
 * A tenant that comes back with a new subscription before its deletion day
 * (`SC-CANC-034`) lifts the end and its announcement: both stay, marked lifted,
 * and the new subscription's own end and announcement are records of their
 * own. "The end" of a subscription is the one that is not lifted.
 *
 * Beside them it keeps every download of the tenant's export, as many per
 * subscription as were taken.
 *
 * An adapter translates. It does not decide whether a subscription ended or
 * which day its data goes; it keeps at most one end and one announcement of a
 * subscription unlifted, and never two of one subscription for one moment, so
 * that a run or a request repeated, or two at once, record each once — and
 * one that read the subscription before it came back does not record the end
 * it lifted a second time. A download it records every time it is asked: each
 * is a download of its own.
 */
export interface SubscriptionEndPort {
    /**
     * Records `end` and returns it as stored — the id is the adapter's to
     * assign, and it is not lifted. Returns null where the subscription has an
     * end that is not lifted, or one, lifted or not, that landed at the same
     * `endsAt`; either is left as it was.
     */
    record(end: NewSubscriptionEnd): Promise<SubscriptionEnd | null>;
    /** The end that is not lifted of those of `subscriptionIds` that have one, in one read. */
    listFor(subscriptionIds: readonly string[]): Promise<SubscriptionEnd[]>;
    /**
     * Every end not lifted whose deletion day is after `day`, whichever
     * tenant it is of, in one read: the soonest deletion first, and by
     * subscription where two share a day. An end deleted on `day` itself is
     * not one of them.
     */
    listDeletingAfter(day: CalendarDay): Promise<SubscriptionEnd[]>;
    /**
     * Records `announcement` and returns it as stored — the id is the
     * adapter's to assign, and it is not lifted. Returns null where the
     * subscription has an announcement that is not lifted, or one, lifted or
     * not, for the same `endsAt`; either is left as it was.
     */
    announce(
        announcement: NewSubscriptionEndAnnouncement,
    ): Promise<SubscriptionEndAnnouncement | null>;
    /** The announcement not lifted of those of `subscriptionIds` that have one, in one read. */
    listAnnouncedFor(subscriptionIds: readonly string[]): Promise<SubscriptionEndAnnouncement[]>;
    /**
     * Lifts, at `liftedAt`, the end of `subscriptionId` that is not lifted and
     * the announcement beside it that is not, in the caller's transaction
     * where one is given and in one of its own otherwise: a new subscription
     * took the tenant back (`SC-CANC-034`). Returns false where no end of the
     * subscription stands, and changes nothing then.
     */
    lift(subscriptionId: string, liftedAt: Date, tx?: TransactionContext): Promise<boolean>;
    /**
     * Records `download` and returns it as stored — the id is the adapter's to
     * assign. Never merged with an earlier download of the same subscription.
     */
    recordExportDownload(download: NewTenantExportDownload): Promise<TenantExportDownload>;
    /**
     * The downloads of `subscriptionIds`, in one read, oldest first: by
     * `downloadedAt`, and by id where two share a moment.
     */
    listExportDownloadsFor(subscriptionIds: readonly string[]): Promise<TenantExportDownload[]>;
    /**
     * Every end of `tenantId`, lifted ones included, whichever subscription it
     * is of, the oldest first.
     */
    listEndsOfTenant(tenantId: string): Promise<SubscriptionEnd[]>;
    /**
     * Every announcement of `tenantId`, lifted ones included, whichever
     * subscription it is of, the oldest first.
     */
    listAnnouncedOfTenant(tenantId: string): Promise<SubscriptionEndAnnouncement[]>;
    /** Every download of `tenantId`'s export, whichever subscription it is of, the oldest first. */
    listExportDownloadsOfTenant(tenantId: string): Promise<TenantExportDownload[]>;
    /**
     * Writes who acted on each end, announcement and download named, as
     * given, in the caller's transaction where one is given; changes nothing
     * else. What a deletion leaves of a tenant's end names roles, not persons
     * (`SC-PRIV-023`).
     */
    replaceActors(
        replacements: {
            readonly ends: readonly { readonly id: string; readonly recordedBy: string }[];
            readonly announcements: readonly {
                readonly id: string;
                readonly announcedBy: string;
            }[];
            readonly downloads: readonly {
                readonly id: string;
                readonly downloadedBy: string;
                readonly downloadedByUserId: string;
            }[];
        },
        tx?: TransactionContext,
    ): Promise<void>;
}

/**
 * Hands over a tenant's full export: everything the application keeps for the
 * tenant, every user's data included, as one file. Implemented by the
 * application, which alone knows what it keeps.
 *
 * The platform asks it only for the tenant of the session that requests the
 * download, and only once an end of that tenant's subscription is recorded. It
 * asks again for every download and keeps nothing of the answer. A rejection
 * is a refusal: the platform records no download and sends no file — and so is
 * an answer that is not a file, which `TenantDataExport` describes.
 *
 * It must settle in bounded time: give the reads behind it the timeouts the
 * application gives its other requests. The platform produces one export of a
 * tenant at a time and cannot cancel one it has asked for, so until a call
 * settles, every further download of that tenant is refused as in progress. A
 * timeout on the platform's side would only let a second export run beside the
 * one still producing, which is what one at a time exists to prevent.
 *
 * An application whose export cannot be held in memory as one file implements
 * no port: it declares `TenantExportDeliveredByTheApplication` instead and
 * delivers the export from a download of its own.
 */
export interface TenantDataExportPort {
    /** The full export of `tenantId`, produced now. */
    export(tenantId: string): Promise<TenantDataExport>;
}

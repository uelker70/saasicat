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

/**
 * Keeps one end per subscription that ended, and one announcement per
 * subscription whose cancellation was confirmed with a deletion day, in the
 * application's own database. The two are separate records: an announcement
 * is written when the cancellation is confirmed and says nothing about whether
 * it has landed; an end is written once it has, with the announced day where
 * there is one.
 *
 * Beside them it keeps every download of the tenant's export, as many per
 * subscription as were taken.
 *
 * An adapter translates. It does not decide whether a subscription ended or
 * which day its data goes; it keeps one end and one announcement per
 * subscription, so that a run or a request repeated, or two at once, record
 * each once. A download it records every time it is asked: each is a download
 * of its own.
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
     * Every end whose deletion day is after `day`, whichever tenant it is
     * of, in one read: the soonest deletion first, and by subscription where
     * two share a day. An end deleted on `day` itself is not one of them.
     */
    listDeletingAfter(day: CalendarDay): Promise<SubscriptionEnd[]>;
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

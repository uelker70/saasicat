// Canonical row -> record mapping for subscription ends, their announcements and the downloads of the
// tenant's export. Pure, and shared by both adapters for the reason `subscription-contract-mapping.ts`
// gives.

import { dayOf } from './column-day.js';
import type {
    SubscriptionEnd,
    SubscriptionEndAnnouncement,
    TenantExportDownload,
} from './subscription-end.types.js';

/**
 * A `subscription_ends` row as either adapter reads it back: `deletesOn` is a
 * `Date` at midnight UTC from Prisma's `@db.Date`, the text itself from
 * Drizzle's `date` in string mode.
 */
export type CanonicalSubscriptionEndRow = Omit<SubscriptionEnd, 'deletesOn'> & {
    deletesOn: unknown;
};

/** Reads a row back as an end, naming each column rather than spreading the row. */
export function toSubscriptionEnd(row: CanonicalSubscriptionEndRow): SubscriptionEnd {
    return {
        id: row.id,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        endsAt: row.endsAt,
        deletesOn: dayOf(row.deletesOn, {
            table: 'subscription_ends',
            column: 'deletesOn',
            id: row.id,
        }),
        recordedAt: row.recordedAt,
        recordedBy: row.recordedBy,
    };
}

/**
 * A `subscription_end_announcements` row as either adapter reads it back, its
 * `deletesOn` in the same two shapes as an end's.
 */
export type CanonicalSubscriptionEndAnnouncementRow = Omit<
    SubscriptionEndAnnouncement,
    'deletesOn'
> & {
    deletesOn: unknown;
};

/** Reads a row back as an announcement, naming each column rather than spreading the row. */
export function toSubscriptionEndAnnouncement(
    row: CanonicalSubscriptionEndAnnouncementRow,
): SubscriptionEndAnnouncement {
    return {
        id: row.id,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        endsAt: row.endsAt,
        readOnlyDays: row.readOnlyDays,
        deletesOn: dayOf(row.deletesOn, {
            table: 'subscription_end_announcements',
            column: 'deletesOn',
            id: row.id,
        }),
        announcedAt: row.announcedAt,
        announcedBy: row.announcedBy,
    };
}

/**
 * A `tenant_export_downloads` row as either adapter reads it back: `size` is a
 * `BIGINT`, which Prisma hands back as a `bigint` and Drizzle in number mode as
 * a `number`.
 */
export type CanonicalTenantExportDownloadRow = Omit<TenantExportDownload, 'size'> & {
    size: unknown;
};

/**
 * Reads a `tenant_export_downloads` row back as a download, naming each column
 * rather than spreading the row, so a column the record does not carry — the
 * row's `createdAt` — is left behind.
 */
export function toTenantExportDownload(
    row: CanonicalTenantExportDownloadRow,
): TenantExportDownload {
    const size = Number(row.size);
    if (!Number.isSafeInteger(size) || size < 1) {
        throw new Error(`tenant_export_downloads.size of ${row.id} is not a size in bytes.`);
    }
    return {
        id: row.id,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        downloadedAt: row.downloadedAt,
        downloadedBy: row.downloadedBy,
        downloadedByUserId: row.downloadedByUserId,
        size,
    };
}

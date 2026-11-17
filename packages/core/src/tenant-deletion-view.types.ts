// What the operator reads of a tenant's deletion (`SC-ADM-058`): where it
// stands, and the record kept of it with the subscriber (`SC-PRIV-023`), as
// JSON carries them. The record names a role for whoever took the export and a
// number for whoever a reminder reached, never a person: it is read after the
// tenant is gone, and also while the rows it is read from still name people.

import type { CalendarDay } from './zoned-day.js';
import type { TenantDeletionStatus } from './tenant-deletion-status.js';
import type {
    CommercialRecordCounts,
    DeletionActorRole,
    TenantCount,
    TenantDeletionFailure,
    TenantKeepLine,
} from './tenant-deletion.types.js';

/** `T` as JSON carries it: every moment as its ISO 8601 text, the rest as it is. */
type MomentsAsText<T> = T extends Date
    ? string
    : T extends readonly (infer Item)[]
      ? readonly MomentsAsText<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: MomentsAsText<T[Key]> }
        : T;

/** Where a tenant's deletion stands (`TenantDeletionStatus`), every moment as ISO 8601 text. */
export type AdminTenantDeletionStatus = MomentsAsText<TenantDeletionStatus>;

/** The last failure a deletion met (`TenantDeletionFailure`), its moment as ISO 8601 text. */
export type AdminTenantDeletionFailure = MomentsAsText<TenantDeletionFailure>;

/** One store's part in a deletion. */
export interface AdminTenantDeletionStore {
    store: string;
    /** Its place in the order the stores are erased in, from 0. */
    position: number;
    /** ISO 8601: when it counted what it held for the tenant; `null` before it did. */
    countedAt: string | null;
    counts: readonly TenantCount[];
    /** ISO 8601: when it confirmed it erased; `null` before it did. */
    erasedAt: string | null;
}

/** A reminder of the deletion sent to the tenant's administrators (`SC-CANC-022`). */
export interface AdminTenantDeletionReminder {
    /** The lead time it answers, in days before the deletion day. */
    daysBefore: number;
    /** ISO 8601: when it was recorded. */
    createdAt: string;
    /** ISO 8601: when the application confirmed it sent it; `null` while it has not. */
    deliveredAt: string | null;
    /** How many it reached — 0 where nobody could be told; `null` while it is not delivered. */
    recipientCount: number | null;
    /** The way it went, in the application's terms; `null` while it is not delivered. */
    channel: string | null;
}

/** A download of the tenant's full export, taken in the read-only period. */
export interface AdminTenantDeletionDownload {
    /** ISO 8601: when the application handed the export over. */
    at: string;
    /** The size of the file handed out, in bytes. */
    size: number;
    /** The role of whoever took it. */
    by: DeletionActorRole;
}

/** The record of a begun deletion, as the subscriber keeps it (`SC-PRIV-023`). */
export interface AdminTenantDeletionRecord {
    /** ISO 8601: when the export was first offered — when the end was recorded (`SC-PRIV-024`). */
    exportOfferedFrom: string;
    /** Whether a suspension kept the export from being taken at some moment before the deletion began. */
    exportBlockedBySuspension: boolean;
    /** The installation's day the tenant confirmed its cancellation and was told the deletion day; `null` where it was not told. */
    announcedOn: CalendarDay | null;
    /** What the tenant was told to keep itself, as the deletion began (`SC-PRIV-022`). */
    keep: readonly TenantKeepLine[];
    /** The stores in the order they are erased in. */
    stores: AdminTenantDeletionStore[];
    /** The subscriber's commercial record before the first store erased. */
    commercialBefore: CommercialRecordCounts | null;
    /** The subscriber's commercial record as the deletion closed, or as it was found short. */
    commercialAfter: CommercialRecordCounts | null;
    /** ISO 8601. */
    startedAt: string;
    /** ISO 8601: when every store had confirmed; `null` until then. */
    closedAt: string | null;
    /** How many times a run failed at it. */
    attempts: number;
    lastFailure: AdminTenantDeletionFailure | null;
    /** The reminders of this end, the first recorded first. */
    reminders: AdminTenantDeletionReminder[];
    /** The downloads of the export offered for this end, the oldest first. */
    downloads: AdminTenantDeletionDownload[];
}

/** A tenant's deletion as the operator reads it. */
export interface AdminTenantDeletion {
    tenantId: string;
    status: AdminTenantDeletionStatus;
    /** The record kept of it; `null` before it began. */
    record: AdminTenantDeletionRecord | null;
}

/** The deletions of a subscriber's tenants, as its record shows them. */
export interface AdminSubscriberDeletions {
    /** Those still to begin first, then the begun ones, the most recently begun first. */
    deletions: AdminTenantDeletion[];
}

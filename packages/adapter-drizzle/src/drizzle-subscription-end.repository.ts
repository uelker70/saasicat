import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { asc, gt, inArray } from 'drizzle-orm';
import {
    type CalendarDay,
    type NewSubscriptionEnd,
    type NewSubscriptionEndAnnouncement,
    type NewTenantExportDownload,
    type SubscriptionEnd,
    type SubscriptionEndAnnouncement,
    type SubscriptionEndPort,
    type TenantExportDownload,
    toSubscriptionEnd,
    toSubscriptionEndAnnouncement,
    toTenantExportDownload,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { subscriptionEndAnnouncements, subscriptionEnds, tenantExportDownloads } from './schema.js';

/**
 * `SubscriptionEndPort` against the canonical `subscription_ends`,
 * `subscription_end_announcements` and `tenant_export_downloads` tables.
 */
@Injectable()
export class DrizzleSubscriptionEndRepository implements SubscriptionEndPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    /**
     * `ON CONFLICT DO NOTHING`: the unique key on `subscriptionId` is what
     * refuses a second end. The id is a uuid made here, so the primary key
     * cannot be the key it met: no row back means the subscription has an end
     * already.
     */
    async record(end: NewSubscriptionEnd): Promise<SubscriptionEnd | null> {
        const [row] = await this.db
            .insert(subscriptionEnds)
            .values({ id: randomUUID(), ...end })
            .onConflictDoNothing()
            .returning();
        return row ? toSubscriptionEnd(row) : null;
    }

    async listFor(subscriptionIds: readonly string[]): Promise<SubscriptionEnd[]> {
        if (subscriptionIds.length === 0) return [];
        const rows = await this.db
            .select()
            .from(subscriptionEnds)
            .where(inArray(subscriptionEnds.subscriptionId, [...subscriptionIds]))
            .orderBy(asc(subscriptionEnds.subscriptionId));
        return rows.map(toSubscriptionEnd);
    }

    /** `deletesOn` is a `date` read as its text, compared as a date by the database. */
    async listDeletingAfter(day: CalendarDay): Promise<SubscriptionEnd[]> {
        const rows = await this.db
            .select()
            .from(subscriptionEnds)
            .where(gt(subscriptionEnds.deletesOn, day))
            .orderBy(asc(subscriptionEnds.deletesOn), asc(subscriptionEnds.subscriptionId));
        return rows.map(toSubscriptionEnd);
    }

    /**
     * `ON CONFLICT DO NOTHING`, as `record`: the unique key on
     * `subscriptionId` is what refuses a second announcement, and the id is a
     * uuid made here, so no row back means the subscription has one already.
     */
    async announce(
        announcement: NewSubscriptionEndAnnouncement,
    ): Promise<SubscriptionEndAnnouncement | null> {
        const [row] = await this.db
            .insert(subscriptionEndAnnouncements)
            .values({ id: randomUUID(), ...announcement })
            .onConflictDoNothing()
            .returning();
        return row ? toSubscriptionEndAnnouncement(row) : null;
    }

    async listAnnouncedFor(
        subscriptionIds: readonly string[],
    ): Promise<SubscriptionEndAnnouncement[]> {
        if (subscriptionIds.length === 0) return [];
        const rows = await this.db
            .select()
            .from(subscriptionEndAnnouncements)
            .where(inArray(subscriptionEndAnnouncements.subscriptionId, [...subscriptionIds]))
            .orderBy(asc(subscriptionEndAnnouncements.subscriptionId));
        return rows.map(toSubscriptionEndAnnouncement);
    }

    /** A plain insert: no key refuses a second download of one subscription. */
    async recordExportDownload(download: NewTenantExportDownload): Promise<TenantExportDownload> {
        const [row] = await this.db
            .insert(tenantExportDownloads)
            .values({ id: randomUUID(), ...download })
            .returning();
        return toTenantExportDownload(row);
    }

    async listExportDownloadsFor(
        subscriptionIds: readonly string[],
    ): Promise<TenantExportDownload[]> {
        if (subscriptionIds.length === 0) return [];
        const rows = await this.db
            .select()
            .from(tenantExportDownloads)
            .where(inArray(tenantExportDownloads.subscriptionId, [...subscriptionIds]))
            .orderBy(asc(tenantExportDownloads.downloadedAt), asc(tenantExportDownloads.id));
        return rows.map(toTenantExportDownload);
    }
}

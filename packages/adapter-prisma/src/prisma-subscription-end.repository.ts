import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalSubscriptionEndAnnouncementRow,
    type CanonicalSubscriptionEndRow,
    type CanonicalTenantExportDownloadRow,
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
    utcMidnightOf,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the injected client used by this repository. */
interface SubscriptionEndPrisma {
    subscriptionEnd: PrismaModelDelegateLike<CanonicalSubscriptionEndRow>;
    subscriptionEndAnnouncement: PrismaModelDelegateLike<CanonicalSubscriptionEndAnnouncementRow>;
    tenantExportDownload: PrismaModelDelegateLike<CanonicalTenantExportDownloadRow>;
}

/**
 * What the constructor takes: a client that has all three delegates. A client
 * generated from a schema without fragment 29, 30 or 31 fails to compile here
 * rather than at the first run.
 */
interface SubscriptionEndRepositoryClient {
    subscriptionEnd: unknown;
    subscriptionEndAnnouncement: unknown;
    tenantExportDownload: unknown;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    tenantId: true,
    subscriptionId: true,
    endsAt: true,
    deletesOn: true,
    recordedAt: true,
    recordedBy: true,
} as const;

/** The columns an announcement read asks for, named for the same reason. */
const ANNOUNCEMENT_COLUMNS = {
    id: true,
    tenantId: true,
    subscriptionId: true,
    endsAt: true,
    readOnlyDays: true,
    deletesOn: true,
    announcedAt: true,
    announcedBy: true,
} as const;

/** The columns a download read asks for, named for the same reason. */
const DOWNLOAD_COLUMNS = {
    id: true,
    tenantId: true,
    subscriptionId: true,
    downloadedAt: true,
    downloadedBy: true,
    downloadedByUserId: true,
    size: true,
} as const;

/**
 * `SubscriptionEndPort` against the canonical `subscription_ends`,
 * `subscription_end_announcements` and `tenant_export_downloads` tables.
 */
@Injectable()
export class PrismaSubscriptionEndRepository implements SubscriptionEndPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: SubscriptionEndRepositoryClient,
    ) {}

    private get db(): SubscriptionEndPrisma {
        // SAFETY: `subscriptionEnd`, `subscriptionEndAnnouncement` and
        // `tenantExportDownload` are the delegates of fragment 29's, 30's and
        // 31's models, whose rows are `CanonicalSubscriptionEndRow`,
        // `CanonicalSubscriptionEndAnnouncementRow` and
        // `CanonicalTenantExportDownloadRow`; the bundle hands this repository
        // the canonical client.
        return this.prisma as SubscriptionEndPrisma;
    }

    /**
     * One statement, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the
     * unique key on `subscriptionId` is what refuses a second end, and it
     * refuses by returning no row rather than by raising. The id is a uuid made
     * here, so the primary key cannot be the key it met.
     */
    async record(end: NewSubscriptionEnd): Promise<SubscriptionEnd | null> {
        const [row] = await this.db.subscriptionEnd.createManyAndReturn({
            data: [{ id: randomUUID(), ...end, deletesOn: utcMidnightOf(end.deletesOn) }],
            skipDuplicates: true,
        });
        return row ? toSubscriptionEnd(row) : null;
    }

    async listFor(subscriptionIds: readonly string[]): Promise<SubscriptionEnd[]> {
        if (subscriptionIds.length === 0) return [];
        const rows = await this.db.subscriptionEnd.findMany({
            where: { subscriptionId: { in: [...subscriptionIds] } },
            select: COLUMNS,
            orderBy: { subscriptionId: 'asc' },
        });
        return rows.map(toSubscriptionEnd);
    }

    /**
     * One statement, as `record`: `skipDuplicates` is `ON CONFLICT DO
     * NOTHING`, so the unique key on `subscriptionId` refuses a second
     * announcement by returning no row rather than by raising.
     */
    async announce(
        announcement: NewSubscriptionEndAnnouncement,
    ): Promise<SubscriptionEndAnnouncement | null> {
        const [row] = await this.db.subscriptionEndAnnouncement.createManyAndReturn({
            data: [
                {
                    id: randomUUID(),
                    ...announcement,
                    deletesOn: utcMidnightOf(announcement.deletesOn),
                },
            ],
            skipDuplicates: true,
        });
        return row ? toSubscriptionEndAnnouncement(row) : null;
    }

    async listAnnouncedFor(
        subscriptionIds: readonly string[],
    ): Promise<SubscriptionEndAnnouncement[]> {
        if (subscriptionIds.length === 0) return [];
        const rows = await this.db.subscriptionEndAnnouncement.findMany({
            where: { subscriptionId: { in: [...subscriptionIds] } },
            select: ANNOUNCEMENT_COLUMNS,
            orderBy: { subscriptionId: 'asc' },
        });
        return rows.map(toSubscriptionEndAnnouncement);
    }

    /** A plain insert: no key refuses a second download of one subscription. */
    async recordExportDownload(download: NewTenantExportDownload): Promise<TenantExportDownload> {
        const row = await this.db.tenantExportDownload.create({
            data: { id: randomUUID(), ...download },
            select: DOWNLOAD_COLUMNS,
        });
        return toTenantExportDownload(row);
    }

    async listExportDownloadsFor(
        subscriptionIds: readonly string[],
    ): Promise<TenantExportDownload[]> {
        if (subscriptionIds.length === 0) return [];
        const rows = await this.db.tenantExportDownload.findMany({
            where: { subscriptionId: { in: [...subscriptionIds] } },
            select: DOWNLOAD_COLUMNS,
            orderBy: [{ downloadedAt: 'asc' }, { id: 'asc' }],
        });
        return rows.map(toTenantExportDownload);
    }
}

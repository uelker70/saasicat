import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CalendarDay,
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
    type TransactionContext,
    toSubscriptionEnd,
    toSubscriptionEndAnnouncement,
    toTenantExportDownload,
    utcMidnightOf,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the client and of a transaction client, which carry the same delegates. */
interface SubscriptionEndPrisma {
    subscriptionEnd: PrismaModelDelegateLike<CanonicalSubscriptionEndRow>;
    subscriptionEndAnnouncement: PrismaModelDelegateLike<CanonicalSubscriptionEndAnnouncementRow>;
    tenantExportDownload: PrismaModelDelegateLike<CanonicalTenantExportDownloadRow>;
}

/**
 * What the constructor takes: a client that has all three delegates, and the
 * interactive transaction a lift without the caller's runs in. A client
 * generated from a schema without fragment 29, 30 or 31 fails to compile here
 * rather than at the first run.
 */
interface SubscriptionEndRepositoryClient {
    subscriptionEnd: unknown;
    subscriptionEndAnnouncement: unknown;
    tenantExportDownload: unknown;
    $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
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
    liftedAt: true,
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
    liftedAt: true,
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
        return this.dbOf();
    }

    private dbOf(tx?: TransactionContext): SubscriptionEndPrisma {
        // SAFETY: `subscriptionEnd`, `subscriptionEndAnnouncement` and
        // `tenantExportDownload` are the delegates of fragment 29's, 30's and
        // 31's models, whose rows are `CanonicalSubscriptionEndRow`,
        // `CanonicalSubscriptionEndAnnouncementRow` and
        // `CanonicalTenantExportDownloadRow`; the bundle hands this repository
        // the canonical client, and a transaction client carries the same
        // delegates.
        return (tx ?? this.prisma) as SubscriptionEndPrisma;
    }

    /**
     * One statement, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the
     * partial unique index on the end not lifted and the unique key on
     * `(subscriptionId, endsAt)` are what refuse a second end, and they refuse
     * by returning no row rather than by raising. The id is a uuid made here,
     * so the primary key cannot be the key it met.
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
            where: { subscriptionId: { in: [...subscriptionIds] }, liftedAt: null },
            select: COLUMNS,
            orderBy: { subscriptionId: 'asc' },
        });
        return rows.map(toSubscriptionEnd);
    }

    /** `deletesOn` is a `@db.Date`, so the day is compared as its midnight UTC. */
    async listDeletingAfter(day: CalendarDay): Promise<SubscriptionEnd[]> {
        const rows = await this.db.subscriptionEnd.findMany({
            where: { deletesOn: { gt: utcMidnightOf(day) }, liftedAt: null },
            select: COLUMNS,
            orderBy: [{ deletesOn: 'asc' }, { subscriptionId: 'asc' }],
        });
        return rows.map(toSubscriptionEnd);
    }

    /**
     * One statement, as `record`: `skipDuplicates` is `ON CONFLICT DO
     * NOTHING`, so the same two keys refuse a second announcement by returning
     * no row rather than by raising.
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
            where: { subscriptionId: { in: [...subscriptionIds] }, liftedAt: null },
            select: ANNOUNCEMENT_COLUMNS,
            orderBy: { subscriptionId: 'asc' },
        });
        return rows.map(toSubscriptionEndAnnouncement);
    }

    /**
     * Two conditional `UPDATE`s in the caller's transaction, or in one of its
     * own: the announcement is lifted only where the end was, and a lift that
     * finds the end lifted already lifts nothing.
     */
    async lift(subscriptionId: string, liftedAt: Date, tx?: TransactionContext): Promise<boolean> {
        const liftIn = async (db: SubscriptionEndPrisma): Promise<boolean> => {
            const { count } = await db.subscriptionEnd.updateMany({
                where: { subscriptionId, liftedAt: null },
                data: { liftedAt },
            });
            if (count === 0) return false;
            await db.subscriptionEndAnnouncement.updateMany({
                where: { subscriptionId, liftedAt: null },
                data: { liftedAt },
            });
            return true;
        };
        if (tx) return liftIn(this.dbOf(tx));
        return this.prisma.$transaction((own) => liftIn(this.dbOf(own)));
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

    async listEndsOfTenant(tenantId: string): Promise<SubscriptionEnd[]> {
        const rows = await this.db.subscriptionEnd.findMany({
            where: { tenantId },
            select: COLUMNS,
            orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
        });
        return rows.map(toSubscriptionEnd);
    }

    async listAnnouncedOfTenant(tenantId: string): Promise<SubscriptionEndAnnouncement[]> {
        const rows = await this.db.subscriptionEndAnnouncement.findMany({
            where: { tenantId },
            select: ANNOUNCEMENT_COLUMNS,
            orderBy: [{ announcedAt: 'asc' }, { id: 'asc' }],
        });
        return rows.map(toSubscriptionEndAnnouncement);
    }

    async listExportDownloadsOfTenant(tenantId: string): Promise<TenantExportDownload[]> {
        const rows = await this.db.tenantExportDownload.findMany({
            where: { tenantId },
            select: DOWNLOAD_COLUMNS,
            orderBy: [{ downloadedAt: 'asc' }, { id: 'asc' }],
        });
        return rows.map(toTenantExportDownload);
    }

    /** One `UPDATE` per row named, by its id: what it names is all that changes. */
    async replaceActors(
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
    ): Promise<void> {
        const db = this.dbOf(tx);
        for (const { id, recordedBy } of replacements.ends) {
            await db.subscriptionEnd.updateMany({ where: { id }, data: { recordedBy } });
        }
        for (const { id, announcedBy } of replacements.announcements) {
            await db.subscriptionEndAnnouncement.updateMany({
                where: { id },
                data: { announcedBy },
            });
        }
        for (const { id, downloadedBy, downloadedByUserId } of replacements.downloads) {
            await db.tenantExportDownload.updateMany({
                where: { id },
                data: { downloadedBy, downloadedByUserId },
            });
        }
    }
}

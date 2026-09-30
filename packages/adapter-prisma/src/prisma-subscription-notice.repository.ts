import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalSubscriptionNoticeRow,
    type SubscriptionNoticeDelivery,
    type SubscriptionNoticeKey,
    type SubscriptionNoticeKind,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
    toSubscriptionNoticeRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the injected client used by this repository. */
interface SubscriptionNoticePrisma {
    subscriptionNotice: PrismaModelDelegateLike<CanonicalSubscriptionNoticeRow>;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    tenantId: true,
    subscriptionId: true,
    kind: true,
    subject: true,
    content: true,
    createdAt: true,
    claimedAt: true,
    deliveredAt: true,
    recipients: true,
    channel: true,
} as const;

/** `SubscriptionNoticeRepository` against the canonical `subscription_notices` table. */
@Injectable()
export class PrismaSubscriptionNoticeRepository implements SubscriptionNoticeRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: unknown) {}

    private get db(): SubscriptionNoticePrisma {
        return this.prisma as SubscriptionNoticePrisma;
    }

    /**
     * An insert that meets the unique key does nothing (`skipDuplicates` is
     * `ON CONFLICT DO NOTHING`), and the claim itself is one guarded `UPDATE`:
     * of two runs at the same moment the database lets one change the row, and
     * the other's condition no longer holds when it gets its turn.
     */
    async claim(
        key: SubscriptionNoticeKey,
        content: unknown,
        now: Date,
        staleBefore: Date,
    ): Promise<SubscriptionNoticeRecord | null> {
        await this.db.subscriptionNotice.createMany({
            data: [{ id: randomUUID(), ...key, content, createdAt: now }],
            skipDuplicates: true,
        });
        const where = {
            tenantId: key.tenantId,
            subscriptionId: key.subscriptionId,
            kind: key.kind,
            subject: key.subject,
        };
        const { count } = await this.db.subscriptionNotice.updateMany({
            where: {
                ...where,
                deliveredAt: null,
                OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
            },
            data: { claimedAt: now, content },
        });
        if (count !== 1) return null;
        const row = await this.db.subscriptionNotice.findFirst({ where, select: COLUMNS });
        return row ? toSubscriptionNoticeRecord(row) : null;
    }

    async confirm(
        id: string,
        claimedAt: Date,
        delivery: SubscriptionNoticeDelivery,
        now: Date,
    ): Promise<boolean> {
        const { count } = await this.db.subscriptionNotice.updateMany({
            where: { id, claimedAt, deliveredAt: null },
            data: {
                deliveredAt: now,
                recipients: [...delivery.recipients],
                channel: delivery.channel,
            },
        });
        return count === 1;
    }

    async release(id: string, claimedAt: Date): Promise<void> {
        await this.db.subscriptionNotice.updateMany({
            where: { id, claimedAt, deliveredAt: null },
            data: { claimedAt: null },
        });
    }

    async listDeliveredSubscriptionIds(
        kind: SubscriptionNoticeKind,
        subject: string,
    ): Promise<string[]> {
        const rows = await this.db.subscriptionNotice.findMany({
            where: { kind, subject, deliveredAt: { not: null } },
            select: { subscriptionId: true },
        });
        return rows.map((row) => row.subscriptionId);
    }

    async listForSubscription(subscriptionId: string): Promise<SubscriptionNoticeRecord[]> {
        const rows = await this.db.subscriptionNotice.findMany({
            where: { subscriptionId },
            select: COLUMNS,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toSubscriptionNoticeRecord);
    }
}

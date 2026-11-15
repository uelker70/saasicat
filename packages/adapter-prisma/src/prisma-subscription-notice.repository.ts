import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalSubscriptionNoticeRow,
    type NoticeToRecord,
    type SubscriptionNoticeDelivery,
    type SubscriptionNoticeKey,
    type SubscriptionNoticeKind,
    type SubscriptionNoticeRecord,
    type SubscriptionNoticeRepository,
    type TransactionContext,
    toSubscriptionNoticeRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the client and of a transaction client, which carry the same delegate. */
interface SubscriptionNoticePrisma {
    subscriptionNotice: PrismaModelDelegateLike<CanonicalSubscriptionNoticeRow>;
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
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
    recipientCount: true,
    recipientsForgottenAt: true,
} as const;

/** `SubscriptionNoticeRepository` against the canonical `subscription_notices` table. */
@Injectable()
export class PrismaSubscriptionNoticeRepository implements SubscriptionNoticeRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: unknown) {}

    private get db(): SubscriptionNoticePrisma {
        return this.dbOf();
    }

    private dbOf(tx?: TransactionContext): SubscriptionNoticePrisma {
        // SAFETY: `subscriptionNotice` is the delegate of fragment 17's model,
        // whose rows read back with `COLUMNS` are `CanonicalSubscriptionNoticeRow`;
        // the bundle hands this repository the canonical client, and a
        // transaction client carries the same delegate and `$executeRaw`.
        return (tx ?? this.prisma) as SubscriptionNoticePrisma;
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

    /**
     * Two guarded `UPDATE`s, the second only where the first changed nothing:
     * a notice whose recipients a tenant's deletion forgot while it was held
     * keeps how many it went to and not to whom. Recipients once forgotten stay
     * forgotten, so a deletion between the two leaves the second to match.
     */
    async confirm(
        id: string,
        claimedAt: Date,
        delivery: SubscriptionNoticeDelivery,
        now: Date,
    ): Promise<boolean> {
        const delivered = (recipients: readonly string[]) => ({
            deliveredAt: now,
            recipients: [...recipients],
            channel: delivery.channel,
            recipientCount: delivery.recipients.length,
        });
        const held = { id, claimedAt, deliveredAt: null };
        const told = await this.db.subscriptionNotice.updateMany({
            where: { ...held, recipientsForgottenAt: null },
            data: delivered(delivery.recipients),
        });
        if (told.count === 1) return true;
        const forgotten = await this.db.subscriptionNotice.updateMany({
            where: { ...held, recipientsForgottenAt: { not: null } },
            data: delivered([]),
        });
        return forgotten.count === 1;
    }

    /**
     * One `UPDATE`, which Prisma's query API cannot express: the number is
     * counted from the recipients the same statement empties. A notice not
     * delivered keeps no recipients to empty, and is marked all the same.
     */
    async forgetRecipients(tenantId: string, at: Date, tx?: TransactionContext): Promise<number> {
        return this.dbOf(tx).$executeRaw`
            UPDATE "subscription_notices"
               SET "recipientCount" = COALESCE(
                       "recipientCount",
                       CASE WHEN jsonb_typeof("recipients") = 'array'
                            THEN jsonb_array_length("recipients") END),
                   "recipients" = CASE WHEN "recipients" IS NULL THEN NULL ELSE '[]'::jsonb END,
                   "recipientsForgottenAt" = (${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')
             WHERE "tenantId" = ${tenantId} AND "recipientsForgottenAt" IS NULL`;
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

    async record(
        notices: readonly NoticeToRecord[],
        now: Date,
        tx?: TransactionContext,
    ): Promise<number> {
        if (notices.length === 0) return 0;
        const { count } = await this.dbOf(tx).subscriptionNotice.createMany({
            data: notices.map(({ content, ...key }) => ({
                id: randomUUID(),
                tenantId: key.tenantId,
                subscriptionId: key.subscriptionId,
                kind: key.kind,
                subject: key.subject,
                content,
                createdAt: now,
            })),
            skipDuplicates: true,
        });
        return count;
    }

    async listOfKindSince(
        kind: SubscriptionNoticeKind,
        since: Date,
    ): Promise<SubscriptionNoticeRecord[]> {
        const rows = await this.db.subscriptionNotice.findMany({
            where: { kind, createdAt: { gte: since } },
            select: COLUMNS,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toSubscriptionNoticeRecord);
    }

    async listUndelivered(
        kind: SubscriptionNoticeKind,
        staleBefore: Date,
    ): Promise<SubscriptionNoticeRecord[]> {
        const rows = await this.db.subscriptionNotice.findMany({
            where: {
                kind,
                deliveredAt: null,
                OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
            },
            select: COLUMNS,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        return rows.map(toSubscriptionNoticeRecord);
    }
}

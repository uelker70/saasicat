import { randomUUID } from 'node:crypto';
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type {
    SubscriberJoinMoves,
    SubscriberJoinRecord,
    SubscriberJoinRepository,
    SubscriberJoinSide,
    SubscriberJoinState,
    SubscriberJoinWrite,
    SubscriberOwnedTable,
    TransactionContext,
} from '@saasicat/core';
import {
    SUBSCRIBER_JOIN_TABLE,
    subscriberJoinGuardsOf,
    subscriberJoinMovedOtherwise,
    subscriberJoinProtectionProblem,
    subscriberJoinSchemaProblem,
    subscriberTablesOf,
    tenantLinksInOrder,
    toSubscriberJoinRecord,
    toSubscriberRecord,
    toSubscriberVatIdCheckRecord,
} from '@saasicat/core';
import { resolveDb, type DrizzleClient } from './client.js';
import {
    subscriberCorrections,
    subscriberCredits,
    subscriberJoins,
    subscriberLedgerEntries,
    subscriberPaymentMethodSetups,
    subscriberPaymentMethods,
    subscriberPayments,
    subscriberReconciliationCases,
    subscriberRefunds,
    subscriberReversals,
    subscriberTaxOriginChanges,
    subscriberTenants,
    subscriberVatIdChecks,
    subscribers,
    subscriptionContracts,
    subscriptionInvoices,
} from './schema.js';
import { triggerNamesOf } from './trigger-names.js';

/** The table of each name that names a subscriber, as the schema declares it. */
const TABLE_OF = {
    subscriber_tenants: subscriberTenants,
    subscriber_corrections: subscriberCorrections,
    subscriber_tax_origin_changes: subscriberTaxOriginChanges,
    subscriber_vat_id_checks: subscriberVatIdChecks,
    subscriber_payment_methods: subscriberPaymentMethods,
    subscriber_payment_method_setups: subscriberPaymentMethodSetups,
    subscriber_ledger_entries: subscriberLedgerEntries,
    subscription_contracts: subscriptionContracts,
    subscription_invoices: subscriptionInvoices,
    subscriber_payments: subscriberPayments,
    subscriber_credits: subscriberCredits,
    subscriber_refunds: subscriberRefunds,
    subscriber_reversals: subscriberReversals,
    subscriber_reconciliation_cases: subscriberReconciliationCases,
} as const satisfies Record<SubscriberOwnedTable, PgTable>;

/**
 * `SubscriberJoinRepository` against `subscriber_joins` and every table that
 * names a subscriber the schema holds: those of a model `notAdopted` leaves
 * out are neither counted nor moved. Built by `drizzlePersistence()`, which
 * hands it the models it was told the schema leaves out.
 */
export class DrizzleSubscriberJoinRepository implements SubscriberJoinRepository {
    private readonly tables: SubscriberOwnedTable[];

    constructor(
        private readonly db: DrizzleClient,
        notAdopted: readonly string[] = [],
    ) {
        this.tables = subscriberTablesOf(notAdopted);
    }

    async hold(
        fromSubscriberId: string,
        intoSubscriberId: string,
        tx: TransactionContext,
    ): Promise<SubscriberJoinState | null> {
        const db = resolveDb(this.db, tx);
        // The lower id first, so two joins of the same pair cannot each hold
        // one row and wait for the other.
        await db
            .select({ id: subscribers.id })
            .from(subscribers)
            .where(inArray(subscribers.id, [fromSubscriberId, intoSubscriberId]))
            .orderBy(subscribers.id)
            .for('update');
        const from = await sideOf(db, fromSubscriberId);
        const into = await sideOf(db, intoSubscriberId);
        if (!from || !into) return null;
        const moving: SubscriberJoinMoves = {};
        for (const table of this.tables) {
            const owned = TABLE_OF[table];
            const [row] = await db
                .select({ n: count() })
                .from(owned)
                .where(eq(owned.subscriberId, fromSubscriberId));
            moving[table] = row?.n ?? 0;
        }
        return { from, into, moving };
    }

    async join(write: SubscriberJoinWrite, tx: TransactionContext): Promise<SubscriberJoinRecord> {
        const db = resolveDb(this.db, tx);
        const { plan, joinedAt, joinedBy, reason } = write;
        const from = plan.fromSubscriberId;
        const into = plan.intoSubscriberId;
        // First: one payment method in use per subscriber is a unique index,
        // and the one moving in is in use.
        if (plan.paymentMethodsOutOfUse > 0) {
            const outOfUse = await db
                .update(subscriberPaymentMethods)
                .set({ status: 'REPLACED', replacedAt: joinedAt })
                .where(
                    and(
                        eq(subscriberPaymentMethods.subscriberId, into),
                        eq(subscriberPaymentMethods.status, 'ACTIVE'),
                    ),
                )
                .returning({ id: subscriberPaymentMethods.id });
            if (outOfUse.length !== plan.paymentMethodsOutOfUse) {
                throw subscriberJoinMovedOtherwise(
                    'subscriber_payment_methods in use',
                    plan.paymentMethodsOutOfUse,
                    outOfUse.length,
                );
            }
        }
        for (const table of this.tables) {
            const owned = TABLE_OF[table];
            const counted = plan.moving[table] ?? 0;
            const moved = await db
                .update(owned)
                .set({ subscriberId: into })
                .where(eq(owned.subscriberId, from))
                .returning({ id: owned.id });
            if (moved.length !== counted)
                throw subscriberJoinMovedOtherwise(table, counted, moved.length);
        }

        const [joined] = await db
            .select()
            .from(subscribers)
            .where(eq(subscribers.id, from))
            .limit(1);
        const details: Partial<typeof subscribers.$inferInsert> = {
            ...plan.contact,
            ...plan.identity?.corrected,
        };
        if (plan.business !== undefined) details.business = plan.business;
        if (plan.vatIdCheck === 'adopted') {
            details.currentVatIdCheckId = plan.adoptedVatIdCheckId;
            details.vatIdSince = joined?.vatIdSince ?? null;
        } else if (plan.vatIdCheck === 'ended') {
            details.currentVatIdCheckId = null;
            details.vatIdSince = joinedAt;
        }
        if (Object.keys(details).length > 0) {
            await db
                .update(subscribers)
                .set({ ...details, updatedAt: joinedAt })
                .where(eq(subscribers.id, into));
        }
        // Its check went with the rest, and counts for the other subscriber now.
        if (joined?.currentVatIdCheckId) {
            await db
                .update(subscribers)
                .set({ currentVatIdCheckId: null, updatedAt: joinedAt })
                .where(eq(subscribers.id, from));
        }
        if (plan.identity) {
            await db.insert(subscriberCorrections).values({
                id: randomUUID(),
                subscriberId: into,
                previous: plan.identity.previous,
                corrected: plan.identity.corrected,
                reason,
                correctedBy: joinedBy,
                correctedAt: joinedAt,
            });
        }
        if (plan.taxOrigin) {
            await db.insert(subscriberTaxOriginChanges).values({
                id: randomUUID(),
                subscriberId: into,
                previous: plan.taxOrigin.previous,
                changed: plan.taxOrigin.changed,
                changedBy: joinedBy,
                changedAt: joinedAt,
                reason,
            });
        }
        const [row] = await db
            .insert(subscriberJoins)
            .values({
                id: randomUUID(),
                fromSubscriberId: from,
                intoSubscriberId: into,
                reason,
                joinedBy,
                joinedAt,
                digest: write.digest,
                moved: plan.moving,
            })
            .returning();
        if (!row) throw new Error('Recording the join of two subscribers returned no row.');
        return toSubscriberJoinRecord(row);
    }

    async listFor(subscriberIds: readonly string[]): Promise<SubscriberJoinRecord[]> {
        if (subscriberIds.length === 0) return [];
        const ids = [...subscriberIds];
        const rows = await this.db
            .select()
            .from(subscriberJoins)
            .where(
                or(
                    inArray(subscriberJoins.fromSubscriberId, ids),
                    inArray(subscriberJoins.intoSubscriberId, ids),
                ),
            );
        return rows.map(toSubscriberJoinRecord);
    }

    async protectionProblem(): Promise<string | null> {
        const missing: string[] = [];
        for (const table of [SUBSCRIBER_JOIN_TABLE.table, ...this.tables]) {
            const present: unknown = await this.db.execute(
                sql`SELECT to_regclass(${table}) IS NOT NULL AS "present"`,
            );
            if (!presentIn(present)) missing.push(table);
        }
        const schema = subscriberJoinSchemaProblem(missing);
        if (schema) return schema;
        const enabled = new Map<string, string[]>();
        for (const { table } of subscriberJoinGuardsOf(this.tables)) {
            // Enabled is `O`, as triggers fire by default, or `A`, always; `D`
            // is disabled, and `R` fires only in a session that replicates.
            const result: unknown = await this.db.execute(sql`
                SELECT tgname::text AS "name" FROM pg_trigger
                 WHERE tgrelid = to_regclass(${table})
                   AND tgenabled IN ('O', 'A')`);
            enabled.set(table, triggerNamesOf(result));
        }
        return subscriberJoinProtectionProblem(this.tables, (table) => enabled.get(table) ?? []);
    }
}

/**
 * Whether the one row a raw query answered says `present`, whichever driver
 * ran it: postgres.js answers the rows themselves, node-postgres a result that
 * holds them.
 */
function presentIn(result: unknown): boolean {
    const rows: unknown =
        typeof result === 'object' && result !== null && 'rows' in result ? result.rows : result;
    const [row]: unknown[] = Array.isArray(rows) ? rows : [];
    return typeof row === 'object' && row !== null && 'present' in row && row.present === true;
}

/** A subscriber with every link it has and had, as a join reads it. */
async function sideOf(db: DrizzleClient, subscriberId: string): Promise<SubscriberJoinSide | null> {
    const [row] = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, subscriberId))
        .limit(1);
    if (!row) return null;
    const links = tenantLinksInOrder(
        await db
            .select({
                tenantId: subscriberTenants.tenantId,
                linkedAt: subscriberTenants.linkedAt,
                unlinkedAt: subscriberTenants.unlinkedAt,
            })
            .from(subscriberTenants)
            .where(eq(subscriberTenants.subscriberId, subscriberId)),
    );
    const live = links.find((link) => link.unlinkedAt === null);
    const [joined] = await db
        .select({ intoSubscriberId: subscriberJoins.intoSubscriberId })
        .from(subscriberJoins)
        .where(eq(subscriberJoins.fromSubscriberId, subscriberId))
        .limit(1);
    const [check] = row.currentVatIdCheckId
        ? await db
              .select()
              .from(subscriberVatIdChecks)
              .where(eq(subscriberVatIdChecks.id, row.currentVatIdCheckId))
              .limit(1)
        : [];
    const [inUse] = await db
        .select({ n: count() })
        .from(subscriberPaymentMethods)
        .where(
            and(
                eq(subscriberPaymentMethods.subscriberId, subscriberId),
                eq(subscriberPaymentMethods.status, 'ACTIVE'),
            ),
        );
    return {
        subscriber: toSubscriberRecord(row, live?.tenantId ?? null),
        links,
        joinedIntoId: joined?.intoSubscriberId ?? null,
        countingVatIdCheck: check ? toSubscriberVatIdCheckRecord(check) : null,
        paymentMethodsInUse: inUse?.n ?? 0,
    };
}

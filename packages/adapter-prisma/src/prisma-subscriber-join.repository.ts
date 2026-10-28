import {
    SUBSCRIBER_JOIN_TABLE,
    subscriberJoinMovedOtherwise,
    subscriberJoinProtectionProblem,
    subscriberJoinSchemaProblem,
    subscriberTablesOf,
    tenantLinksInOrder,
    toSubscriberJoinRecord,
    toSubscriberRecord,
    toSubscriberVatIdCheckRecord,
} from '@saasicat/core';
import type {
    CanonicalSubscriberJoinRow,
    CanonicalSubscriberRow,
    CanonicalSubscriberVatIdCheckRow,
    SubscriberJoinMoves,
    SubscriberJoinRecord,
    SubscriberJoinRepository,
    SubscriberJoinSide,
    SubscriberJoinState,
    SubscriberContactChange,
    SubscriberIdentityValues,
    SubscriberJoinWrite,
    SubscriberOwnedTable,
    TransactionContext,
} from '@saasicat/core';
import type { PrismaModelDelegateLike } from './prisma-client-token.js';

/** A subscriber row with every link it has and had. */
type SubscriberJoinDbRow = CanonicalSubscriberRow & {
    currentVatIdCheckId: string | null;
    vatIdSince: Date | null;
    tenants: Array<{ tenantId: string; linkedAt: Date; unlinkedAt: Date | null }>;
};

/** What a join writes on the subscriber it joins into, each member only where it moves. */
type JoinedDetails = SubscriberContactChange &
    SubscriberIdentityValues & {
        business?: boolean | null;
        currentVatIdCheckId?: string | null;
        vatIdSince?: Date | null;
    };

/** The delegate of each table that names a subscriber, by the client's name for it. */
const DELEGATE_OF = {
    subscriber_tenants: 'subscriberTenant',
    subscriber_corrections: 'subscriberCorrection',
    subscriber_tax_origin_changes: 'subscriberTaxOriginChange',
    subscriber_vat_id_checks: 'subscriberVatIdCheck',
    subscriber_payment_methods: 'subscriberPaymentMethod',
    subscriber_payment_method_setups: 'subscriberPaymentMethodSetup',
    subscriber_ledger_entries: 'subscriberLedgerEntry',
    subscription_contracts: 'subscriptionContract',
    subscription_invoices: 'subscriptionInvoice',
    subscriber_payments: 'subscriberPayment',
    subscriber_credits: 'subscriberCredit',
    subscriber_refunds: 'subscriberRefund',
    subscriber_reversals: 'subscriberReversal',
    subscriber_reconciliation_cases: 'subscriberReconciliationCase',
} as const satisfies Record<SubscriberOwnedTable, string>;

type OwnedDelegates = {
    [
        table in SubscriberOwnedTable as (typeof DELEGATE_OF)[table]
    ]: PrismaModelDelegateLike<unknown>;
};

/** Narrow view of a transaction client: the delegates a join reads and writes. */
interface JoinPrisma extends OwnedDelegates {
    subscriber: PrismaModelDelegateLike<SubscriberJoinDbRow>;
    subscriberVatIdCheck: PrismaModelDelegateLike<CanonicalSubscriberVatIdCheckRow>;
    subscriberJoin: PrismaModelDelegateLike<CanonicalSubscriberJoinRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * What the client must have whatever the schema adopts: the subscribers, which
 * every schema keeps, and raw queries. The delegates of the other tables are
 * asked for at the start (`protectionProblem`), because a schema may leave them
 * out.
 */
interface SubscriberJoinClient {
    subscriber: unknown;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * `SubscriberJoinRepository` against `subscriber_joins` and every table that
 * names a subscriber the schema holds: those of a model `notAdopted` leaves
 * out are neither counted nor moved. Built by `prismaPersistence()`, which
 * hands it the models it was told the schema leaves out.
 */
export class PrismaSubscriberJoinRepository implements SubscriberJoinRepository {
    private readonly tables: SubscriberOwnedTable[];

    constructor(
        private readonly prisma: SubscriberJoinClient,
        notAdopted: readonly string[] = [],
    ) {
        this.tables = subscriberTablesOf(notAdopted);
    }

    private db(tx?: TransactionContext): JoinPrisma {
        // SAFETY: the root client and every transaction client it hands out
        // carry the delegate of every model the schema adopts and `$queryRaw`;
        // only the tables `subscriberTablesOf` keeps are reached, and the
        // generated-client test compiles this adapter against the fragments.
        return (tx ?? this.prisma) as JoinPrisma;
    }

    async hold(
        fromSubscriberId: string,
        intoSubscriberId: string,
        tx: TransactionContext,
    ): Promise<SubscriberJoinState | null> {
        const db = this.db(tx);
        // The lower id first, so two joins of the same pair cannot each hold
        // one row and wait for the other.
        await db.$queryRaw`
            SELECT "id" FROM "subscribers"
             WHERE "id" IN (${fromSubscriberId}, ${intoSubscriberId})
             ORDER BY "id" FOR UPDATE`;
        const from = await this.sideOf(db, fromSubscriberId);
        const into = await this.sideOf(db, intoSubscriberId);
        if (!from || !into) return null;
        const moving: SubscriberJoinMoves = {};
        for (const table of this.tables) {
            moving[table] = await db[DELEGATE_OF[table]].count({
                where: { subscriberId: fromSubscriberId },
            });
        }
        return { from, into, moving };
    }

    private async sideOf(db: JoinPrisma, subscriberId: string): Promise<SubscriberJoinSide | null> {
        const row = await db.subscriber.findUnique({
            where: { id: subscriberId },
            include: { tenants: { select: { tenantId: true, linkedAt: true, unlinkedAt: true } } },
        });
        if (!row) return null;
        const links = tenantLinksInOrder(row.tenants);
        const live = links.find((link) => link.unlinkedAt === null);
        const joined = await db.subscriberJoin.findUnique({
            where: { fromSubscriberId: subscriberId },
        });
        const check = row.currentVatIdCheckId
            ? await db.subscriberVatIdCheck.findUnique({ where: { id: row.currentVatIdCheckId } })
            : null;
        return {
            subscriber: toSubscriberRecord(row, live?.tenantId ?? null),
            links,
            joinedIntoId: joined?.intoSubscriberId ?? null,
            countingVatIdCheck: check ? toSubscriberVatIdCheckRecord(check) : null,
            paymentMethodsInUse: await db.subscriberPaymentMethod.count({
                where: { subscriberId, status: 'ACTIVE' },
            }),
        };
    }

    async join(write: SubscriberJoinWrite, tx: TransactionContext): Promise<SubscriberJoinRecord> {
        const db = this.db(tx);
        const { plan, joinedAt, joinedBy, reason } = write;
        const from = plan.fromSubscriberId;
        const into = plan.intoSubscriberId;
        // First: one payment method in use per subscriber is a unique index,
        // and the one moving in is in use.
        if (plan.paymentMethodsOutOfUse > 0) {
            const { count } = await db.subscriberPaymentMethod.updateMany({
                where: { subscriberId: into, status: 'ACTIVE' },
                data: { status: 'REPLACED', replacedAt: joinedAt },
            });
            if (count !== plan.paymentMethodsOutOfUse) {
                throw subscriberJoinMovedOtherwise(
                    'subscriber_payment_methods in use',
                    plan.paymentMethodsOutOfUse,
                    count,
                );
            }
        }
        for (const table of this.tables) {
            const counted = plan.moving[table] ?? 0;
            const { count } = await db[DELEGATE_OF[table]].updateMany({
                where: { subscriberId: from },
                data: { subscriberId: into },
            });
            if (count !== counted) throw subscriberJoinMovedOtherwise(table, counted, count);
        }

        const joined = await db.subscriber.findUnique({ where: { id: from } });
        const details: JoinedDetails = { ...plan.contact, ...plan.identity?.corrected };
        if (plan.business !== undefined) details.business = plan.business;
        if (plan.vatIdCheck === 'adopted') {
            details.currentVatIdCheckId = plan.adoptedVatIdCheckId;
            details.vatIdSince = joined?.vatIdSince ?? null;
        } else if (plan.vatIdCheck === 'ended') {
            details.currentVatIdCheckId = null;
            details.vatIdSince = joinedAt;
        }
        if (Object.keys(details).length > 0) {
            await db.subscriber.update({ where: { id: into }, data: details });
        }
        // Its check went with the rest, and counts for the other subscriber now.
        if (joined?.currentVatIdCheckId) {
            await db.subscriber.update({
                where: { id: from },
                data: { currentVatIdCheckId: null },
            });
        }
        if (plan.identity) {
            await db.subscriberCorrection.create({
                data: {
                    subscriberId: into,
                    previous: plan.identity.previous,
                    corrected: plan.identity.corrected,
                    reason,
                    correctedBy: joinedBy,
                    correctedAt: joinedAt,
                },
            });
        }
        if (plan.taxOrigin) {
            await db.subscriberTaxOriginChange.create({
                data: {
                    subscriberId: into,
                    previous: plan.taxOrigin.previous,
                    changed: plan.taxOrigin.changed,
                    changedBy: joinedBy,
                    changedAt: joinedAt,
                    reason,
                },
            });
        }
        const row = await db.subscriberJoin.create({
            data: {
                fromSubscriberId: from,
                intoSubscriberId: into,
                reason,
                joinedBy,
                joinedAt,
                digest: write.digest,
                moved: plan.moving,
            },
        });
        return toSubscriberJoinRecord(row);
    }

    async listFor(subscriberIds: readonly string[]): Promise<SubscriberJoinRecord[]> {
        if (subscriberIds.length === 0) return [];
        const rows = await this.db().subscriberJoin.findMany({
            where: {
                OR: [
                    { fromSubscriberId: { in: [...subscriberIds] } },
                    { intoSubscriberId: { in: [...subscriberIds] } },
                ],
            },
        });
        return rows.map(toSubscriberJoinRecord);
    }

    async protectionProblem(): Promise<string | null> {
        const client: unknown = this.prisma;
        const reached = [SUBSCRIBER_JOIN_TABLE.table, ...this.tables];
        const present: unknown = await this.db().$queryRaw`
            SELECT owned AS "table" FROM unnest(${reached}::text[]) AS owned
             WHERE to_regclass(owned) IS NOT NULL`;
        const inDatabase = Array.isArray(present)
            ? present.filter(isTableRow).map((row) => row.table)
            : [];
        const missing = reached.filter(
            (table) =>
                !inDatabase.includes(table) ||
                !hasDelegate(
                    client,
                    table === SUBSCRIBER_JOIN_TABLE.table ? 'subscriberJoin' : DELEGATE_OF[table],
                ),
        );
        const schema = subscriberJoinSchemaProblem(missing);
        if (schema) return schema;
        // Enabled is `O`, as triggers fire by default, or `A`, always; `D` is
        // disabled, and `R` fires only in a session that replicates.
        const rows: unknown = await this.db().$queryRaw`
            SELECT owned AS "table", t.tgname::text AS "name"
              FROM unnest(${this.tables}::text[]) AS owned
              JOIN pg_trigger t ON t.tgrelid = to_regclass(owned)
             WHERE t.tgenabled IN ('O', 'A')`;
        const enabled = Array.isArray(rows) ? rows.filter(isTriggerRow) : [];
        return subscriberJoinProtectionProblem(this.tables, (table) =>
            enabled.filter((row) => row.table === table).map((row) => row.name),
        );
    }
}

/** Whether the client carries a delegate `name` that counts: the schema it was generated from adopts the model. */
function hasDelegate(client: unknown, name: keyof OwnedDelegates | 'subscriberJoin'): boolean {
    // The client's delegates are not all own properties of it, so `in` asks.
    if (typeof client !== 'object' || client === null || !(name in client)) return false;
    // SAFETY: `name in client` held just above, so the client has the member
    // the index reads; what it is, the line after asks.
    const delegate: unknown = (client as Partial<JoinPrisma>)[name];
    return typeof delegate === 'object' && delegate !== null && 'count' in delegate;
}

function isTableRow(row: unknown): row is { table: string } {
    return (
        typeof row === 'object' &&
        row !== null &&
        typeof Object.getOwnPropertyDescriptor(row, 'table')?.value === 'string'
    );
}

function isTriggerRow(row: unknown): row is { table: string; name: string } {
    return (
        typeof row === 'object' &&
        row !== null &&
        typeof Object.getOwnPropertyDescriptor(row, 'table')?.value === 'string' &&
        typeof Object.getOwnPropertyDescriptor(row, 'name')?.value === 'string'
    );
}

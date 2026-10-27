import { Inject, Injectable } from '@nestjs/common';
import type {
    ContractRegisterRecordPage,
    ContractRegisterWindow,
    NewContractLineItemData,
    NewSubscriptionContractData,
    RunningContractIssuers,
    SubscriptionContractFilter,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    SubscriptionContractStatus,
    SupersedeSubscriptionContractData,
    TerminateSubscriptionContractData,
    TransactionContext,
} from '@saasicat/core';
import {
    ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES,
    subscriptionContractGone,
    taxTreatmentToJson,
    toRunningContractIssuer,
    toSubscriptionContractRecord,
    type CanonicalContractLineItemRow,
    type CanonicalContractRow,
    type CanonicalRunningContractRow,
} from '@saasicat/core';
import {
    PRISMA_CLIENT_TOKEN,
    type DecimalLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import { isRecordNotFound } from './prisma-record-not-found.js';
import { idsOf } from './raw-ids.js';

/** The `where` of a contract list, each part only where the filter names it. */
interface ContractListWhere {
    tenantId?: string;
    subscriberId?: string;
    status?: SubscriptionContractStatus;
    effectiveFrom?: { lte: Date };
    OR?: Array<{ effectiveUntil: null } | { effectiveUntil: { gt: Date } }>;
}

/**
 * What this repository reads from `contract_line_items`.
 *
 * The columns come from the canonical row in `@saasicat/core` — the same list
 * that maps them — and this narrows only the money ones, which Prisma hands
 * back as `Decimal` where the canonical row says `unknown`. Written out again
 * instead, it fell behind the moment a column was added, and the failure was
 * the reader and the mapper disagreeing about what a row holds.
 */
type ContractLineItemDbRow = CanonicalContractLineItemRow & {
    priceNet: DecimalLike;
    priceGross: DecimalLike;
    taxRate: DecimalLike;
    taxAmount: DecimalLike;
};

/**
 * What this repository reads back: the canonical contract row plus its lines.
 * The column list itself comes from `@saasicat/core`, which is also what maps
 * it — declaring it a second time here is how the mapper and the reader start
 * to disagree about what a column holds.
 */
type SubscriptionContractDbRow = CanonicalContractRow & {
    lineItems: ContractLineItemDbRow[];
};

/** The one delegate this repository reads and writes, whatever else the client carries. */
interface SubscriptionContractRepositoryClient {
    subscriptionContract: unknown;
}

/** Narrow view of the injected client used by this repository. */
interface SubscriptionContractPrisma {
    subscriptionContract: PrismaModelDelegateLike<SubscriptionContractDbRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * A register window as the parameters of one statement: its kind, and the
 * moments it compares with as ISO text, `null` where it compares with none.
 */
function windowParametersOf(window: ContractRegisterWindow): {
    kind: ContractRegisterWindow['kind'];
    from: string | null;
    until: string | null;
} {
    switch (window.kind) {
        case 'overlapping':
            return {
                kind: window.kind,
                from: window.from.toISOString(),
                until: window.until.toISOString(),
            };
        case 'ended-by':
            return { kind: window.kind, from: window.by.toISOString(), until: null };
        case 'starting-from':
            return { kind: window.kind, from: window.from.toISOString(), until: null };
        case 'all':
        case 'never-in-force':
            return { kind: window.kind, from: null, until: null };
    }
}

/**
 * The same delegate, seen as the four columns the issuer check selects.
 *
 * Prisma types a `select` by what it selects and this package types delegates
 * by their row, so the narrow query needs its own view rather than pretending
 * a four-column row is a whole contract.
 */
interface RunningContractPrisma {
    subscriptionContract: PrismaModelDelegateLike<CanonicalRunningContractRow>;
}

/**
 * Append-only `SubscriptionContractRepository` against the canonical
 * `subscription_contracts` + `contract_line_items` tables. Contracts store full
 * snapshots and are never rewritten: `create` writes the contract and its line
 * items atomically via a single nested-create, and `terminate` only closes a
 * contract (sets `effectiveUntil` + `status`). There is no line-item mutation.
 */
@Injectable()
export class PrismaSubscriptionContractRepository implements SubscriptionContractRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: SubscriptionContractRepositoryClient,
    ) {}

    private db(tx?: TransactionContext): SubscriptionContractPrisma {
        return (tx ?? this.prisma) as unknown as SubscriptionContractPrisma;
    }

    async list(filter: SubscriptionContractFilter): Promise<SubscriptionContractRecord[]> {
        const where: ContractListWhere = {};
        if (filter.tenantId) where.tenantId = filter.tenantId;
        if (filter.subscriberId) where.subscriberId = filter.subscriberId;
        if (filter.status) where.status = filter.status;
        if (filter.asOf) {
            where.effectiveFrom = { lte: filter.asOf };
            where.OR = [{ effectiveUntil: null }, { effectiveUntil: { gt: filter.asOf } }];
        }
        const rows = await this.db().subscriptionContract.findMany({
            where,
            include: { lineItems: true },
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        });
        return rows.map((row) => toSubscriptionContractRecord(row, row.lineItems));
    }

    async listRegister(page: {
        window: ContractRegisterWindow;
        limit: number;
        after?: string;
    }): Promise<ContractRegisterRecordPage> {
        const db = this.db();
        const { kind, from, until } = windowParametersOf(page.window);
        // A contract never in force ends no later than it starts; every window
        // but `all` and `never-in-force` leaves it out.
        const rows = await db.$queryRaw`
            WITH after_it AS (
                SELECT "effectiveFrom", "createdAt", "id"
                  FROM "subscription_contracts" WHERE "id" = ${page.after ?? null}
            )
            SELECT c."id"
              FROM "subscription_contracts" c
             WHERE (
                       ${kind}::text = 'all'
                    OR (${kind}::text = 'never-in-force'
                        AND c."effectiveUntil" IS NOT NULL AND c."effectiveUntil" <= c."effectiveFrom")
                    OR (NOT (c."effectiveUntil" IS NOT NULL AND c."effectiveUntil" <= c."effectiveFrom")
                        AND (
                               (${kind}::text = 'overlapping'
                                AND c."effectiveFrom" < (${until}::timestamptz AT TIME ZONE 'UTC')
                                AND (c."effectiveUntil" IS NULL
                                     OR c."effectiveUntil" > (${from}::timestamptz AT TIME ZONE 'UTC')))
                            OR (${kind}::text = 'ended-by'
                                AND c."effectiveUntil" <= (${from}::timestamptz AT TIME ZONE 'UTC'))
                            OR (${kind}::text = 'starting-from'
                                AND c."effectiveFrom" >= (${from}::timestamptz AT TIME ZONE 'UTC'))
                        ))
                   )
               AND NOT EXISTS (
                       SELECT 1 FROM after_it a
                        WHERE (c."effectiveFrom", c."createdAt", c."id")
                           >= (a."effectiveFrom", a."createdAt", a."id")
                   )
             ORDER BY c."effectiveFrom" DESC, c."createdAt" DESC, c."id" DESC
             LIMIT ${page.limit + 1}`;
        const ids = idsOf(rows);
        const listed = ids.slice(0, page.limit);
        const byId = new Map(
            (
                await db.subscriptionContract.findMany({
                    where: { id: { in: listed } },
                    include: { lineItems: true },
                })
            ).map((row) => [row.id, row]),
        );
        return {
            contracts: listed.map((id) => {
                const row = byId.get(id);
                // No port deletes a contract, so the one the query above listed
                // is there; a contract is not left off the register unnoticed.
                if (!row) throw new Error(`The contract ${id} cannot be read.`);
                return toSubscriptionContractRecord(row, row.lineItems);
            }),
            hasMore: ids.length > page.limit,
        };
    }

    async findById(contractId: string): Promise<SubscriptionContractRecord | null> {
        const row = await this.db().subscriptionContract.findUnique({
            where: { id: contractId },
            include: { lineItems: true },
        });
        return row ? toSubscriptionContractRecord(row, row.lineItems) : null;
    }

    async findActiveByTenantId(
        tenantId: string,
        asOf: Date = new Date(),
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null> {
        const row = await this.db(tx).subscriptionContract.findFirst({
            where: {
                tenantId,
                status: { in: [...ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES] },
                effectiveFrom: { lte: asOf },
                OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: asOf } }],
            },
            include: { lineItems: true },
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        });
        return row ? toSubscriptionContractRecord(row, row.lineItems) : null;
    }

    async findByOriginalOfferId(
        offerId: string,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null> {
        const row = await this.db(tx).subscriptionContract.findFirst({
            where: { originalOfferId: offerId },
            include: { lineItems: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        return row ? toSubscriptionContractRecord(row, row.lineItems) : null;
    }

    async create(
        data: NewSubscriptionContractData,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord> {
        const row = await this.db(tx).subscriptionContract.create({
            data: {
                tenantId: data.tenantId,
                subscriberId: data.parties.subscriberId,
                subscriberSnapshot: data.parties.subscriber,
                partiesMigrated: data.partiesMigrated ?? false,
                cancellationNoticeDays: data.cancellationNoticeDays,
                termsVersion: data.termsVersion,
                agreedAt: data.agreedAt,
                // Every contract written is confirmed to its subscriber
                // (`SC-AUD-016`); the column's default is for those before.
                confirmationDue: true,
                status: data.status ?? 'active',
                effectiveFrom: data.effectiveFrom,
                effectiveUntil: data.effectiveUntil ?? null,
                originalOfferId: data.originalOfferId ?? null,
                originalPlanVersionId: data.originalPlanVersionId ?? null,
                originalBundleVersionIds: data.originalBundleVersionIds ?? [],
                priceSnapshot: data.priceSnapshot,
                promotionSnapshots: data.promotionSnapshots ?? [],
                promoCodeSnapshots: data.promoCodeSnapshots ?? [],
                // Nullable JSON columns are omitted when absent so they stay SQL
                // NULL (the DbNull sentinel is not available in this package).
                ...(data.entitlementSnapshot != null
                    ? { entitlementSnapshot: data.entitlementSnapshot }
                    : {}),
                ...(data.termsSnapshot != null ? { termsSnapshot: data.termsSnapshot } : {}),
                ...(data.parties.issuer != null ? { issuerSnapshot: data.parties.issuer } : {}),
                ...(data.taxTreatment != null
                    ? { taxTreatment: taxTreatmentToJson(data.taxTreatment) }
                    : {}),
                lineItems: { create: data.lineItems.map(toLineItemCreate) },
            },
            include: { lineItems: true },
        });
        return toSubscriptionContractRecord(row, row.lineItems);
    }

    async listRunningIssuers(
        limit: number,
        asOf: Date = new Date(),
    ): Promise<RunningContractIssuers> {
        const where = {
            status: { in: [...ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES] },
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: asOf } }],
        };
        const contracts = (this.db() as unknown as RunningContractPrisma).subscriptionContract;
        const [total, rows] = await Promise.all([
            contracts.count({ where }),
            // Oldest first, and `id` last so two contracts that start in the
            // same moment are still listed in one order — a refusal that names
            // a different pair on every restart is one an operator cannot act
            // on.
            contracts.findMany({
                where,
                select: { id: true, tenantId: true, issuerSnapshot: true, effectiveFrom: true },
                orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
                take: limit,
            }),
        ]);
        return { total, contracts: rows.map(toRunningContractIssuer) };
    }

    async terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord> {
        let row: SubscriptionContractDbRow;
        try {
            // One statement that writes and hands back what it wrote, so a
            // second writer cannot land between the two.
            row = await this.db().subscriptionContract.update({
                where: { id: contractId, tenantId: data.tenantId },
                // A null status leaves the column alone: the contract keeps
                // whatever it had — `active`, usually — and its new
                // `effectiveUntil` is what takes it out of the active lookup
                // once that moment arrives.
                data: {
                    effectiveUntil: data.effectiveUntil,
                    ...(data.status === null ? {} : { status: data.status }),
                },
                include: { lineItems: true },
            });
        } catch (error) {
            if (isRecordNotFound(error)) throw subscriptionContractGone(contractId);
            throw error;
        }
        return toSubscriptionContractRecord(row, row.lineItems);
    }

    async supersede(
        contractId: string,
        data: SupersedeSubscriptionContractData,
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null> {
        const db = this.db(tx);
        // One conditional statement: PostgreSQL re-reads the row under its lock
        // before it writes, so a second caller superseding the same contract
        // finds the first one's status here and counts nothing.
        const { count } = await db.subscriptionContract.updateMany({
            where: {
                id: contractId,
                tenantId: data.tenantId,
                status: { in: [...ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES] },
                effectiveUntil: data.readEffectiveUntil,
            },
            data: { effectiveUntil: data.at, status: 'superseded' },
        });
        if (count === 0) return null;
        const row = await db.subscriptionContract.findUnique({
            where: { id: contractId },
            include: { lineItems: true },
        });
        return row ? toSubscriptionContractRecord(row, row.lineItems) : null;
    }
}

function toLineItemCreate(item: NewContractLineItemData) {
    return {
        kind: item.kind,
        sourceKey: item.sourceKey,
        sourceVersionId: item.sourceVersionId ?? null,
        titleSnapshot: item.titleSnapshot,
        descriptionSnapshot: item.descriptionSnapshot ?? null,
        quantity: item.quantity,
        unit: item.unit ?? null,
        priceNet: item.priceNet,
        priceGross: item.priceGross,
        billingCycle: item.billingCycle,
        currency: item.currency,
        taxRate: item.taxRate,
        taxAmount: item.taxAmount,
        minimumTermUntil: item.minimumTermUntil ?? null,
        featuresSnapshot: item.featuresSnapshot,
        quotaEffectsSnapshot: item.quotaEffectsSnapshot,
        ...(item.metadata != null ? { metadata: item.metadata } : {}),
    };
}

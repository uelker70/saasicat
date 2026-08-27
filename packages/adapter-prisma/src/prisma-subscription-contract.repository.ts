import { Inject, Injectable } from '@nestjs/common';
import type {
    CreateSubscriptionContractData,
    NewContractLineItemData,
    SubscriptionContractFilter,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    TerminateSubscriptionContractData,
    TransactionContext,
} from '@saasicat/core';
import {
    ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES,
    toSubscriptionContractRecord,
    type CanonicalContractRow,
} from '@saasicat/core';
import {
    PRISMA_CLIENT_TOKEN,
    type DecimalLike,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';

/** DB columns this repository reads from `contract_line_items`. */
interface ContractLineItemDbRow {
    id: string;
    contractId: string;
    kind: string;
    sourceKey: string;
    sourceVersionId: string | null;
    titleSnapshot: string;
    descriptionSnapshot: string | null;
    quantity: number;
    unit: string | null;
    priceNet: DecimalLike;
    priceGross: DecimalLike;
    billingCycle: string;
    minimumTermUntil: Date | null;
    featuresSnapshot: unknown;
    quotaEffectsSnapshot: unknown;
    metadata: unknown;
    createdAt: Date;
}

/**
 * What this repository reads back: the canonical contract row plus its lines.
 * The column list itself comes from `@saasicat/core`, which is also what maps
 * it — declaring it a second time here is how the mapper and the reader start
 * to disagree about what a column holds.
 */
type SubscriptionContractDbRow = CanonicalContractRow & {
    lineItems: ContractLineItemDbRow[];
};

/** Narrow view of the injected client used by this repository. */
interface SubscriptionContractPrisma {
    subscriptionContract: PrismaModelDelegateLike<SubscriptionContractDbRow>;
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
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    private db(tx?: TransactionContext): SubscriptionContractPrisma {
        return (tx ?? this.prisma) as unknown as SubscriptionContractPrisma;
    }

    async list(filter: SubscriptionContractFilter): Promise<SubscriptionContractRecord[]> {
        const rows = await this.db().subscriptionContract.findMany({
            where: {
                ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
                ...(filter.status ? { status: filter.status } : {}),
                ...(filter.asOf
                    ? {
                          effectiveFrom: { lte: filter.asOf },
                          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: filter.asOf } }],
                      }
                    : {}),
            },
            include: { lineItems: true },
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        });
        return rows.map((row) => toSubscriptionContractRecord(row, row.lineItems));
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

    async create(data: CreateSubscriptionContractData): Promise<SubscriptionContractRecord> {
        const row = await this.db().subscriptionContract.create({
            data: {
                tenantId: data.tenantId,
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
                lineItems: { create: data.lineItems.map(toLineItemCreate) },
            },
            include: { lineItems: true },
        });
        return toSubscriptionContractRecord(row, row.lineItems);
    }

    async terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord> {
        const row = await this.db().subscriptionContract.update({
            where: { id: contractId },
            // A null status leaves the column alone: the contract keeps whatever
            // it had — `active`, usually — and its new `effectiveUntil` is what
            // takes it out of the active lookup once that moment arrives.
            data: {
                effectiveUntil: data.effectiveUntil,
                ...(data.status === null ? {} : { status: data.status }),
            },
            include: { lineItems: true },
        });
        return toSubscriptionContractRecord(row, row.lineItems);
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
        minimumTermUntil: item.minimumTermUntil ?? null,
        featuresSnapshot: item.featuresSnapshot,
        quotaEffectsSnapshot: item.quotaEffectsSnapshot,
        ...(item.metadata != null ? { metadata: item.metadata } : {}),
    };
}

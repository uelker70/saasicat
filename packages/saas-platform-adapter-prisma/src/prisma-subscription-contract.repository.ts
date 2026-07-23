import { Inject, Injectable } from '@nestjs/common';
import type {
    ContractLineItemKind,
    ContractLineItemRecord,
    CreateSubscriptionContractData,
    EffectiveLimitsSnapshot,
    NewContractLineItemData,
    SubscriptionContractFilter,
    SubscriptionContractPriceSnapshot,
    SubscriptionContractRecord,
    SubscriptionContractRepository,
    SubscriptionContractStatus,
    TerminateSubscriptionContractData,
} from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type DecimalLike,
    type PrismaLike,
    type PrismaModelDelegateLike,
} from './prisma-client-token.js';
import { toQuotaMap, toStringArray } from './tx.js';

const ACTIVE_CONTRACT_STATUSES = ['active', 'scheduled'];

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

/** DB columns this repository reads from `subscription_contracts` (+ line items). */
interface SubscriptionContractDbRow {
    id: string;
    projectKey: string;
    tenantId: string;
    status: string;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
    originalOfferId: string | null;
    originalPlanVersionId: string | null;
    originalBundleVersionIds: unknown;
    entitlementSnapshot: unknown;
    priceSnapshot: unknown;
    promotionSnapshots: unknown;
    promoCodeSnapshots: unknown;
    termsSnapshot: unknown;
    createdAt: Date;
    updatedAt: Date;
    lineItems: ContractLineItemDbRow[];
}

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

    private get db(): SubscriptionContractPrisma {
        return this.prisma as unknown as SubscriptionContractPrisma;
    }

    async list(filter: SubscriptionContractFilter): Promise<SubscriptionContractRecord[]> {
        const rows = await this.db.subscriptionContract.findMany({
            where: {
                ...(filter.projectKey ? { projectKey: filter.projectKey } : {}),
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
        return rows.map(toRecord);
    }

    async findById(contractId: string): Promise<SubscriptionContractRecord | null> {
        const row = await this.db.subscriptionContract.findUnique({
            where: { id: contractId },
            include: { lineItems: true },
        });
        return row ? toRecord(row) : null;
    }

    async findActiveByTenantId(
        tenantId: string,
        asOf: Date = new Date(),
    ): Promise<SubscriptionContractRecord | null> {
        const row = await this.db.subscriptionContract.findFirst({
            where: {
                tenantId,
                status: { in: ACTIVE_CONTRACT_STATUSES },
                effectiveFrom: { lte: asOf },
                OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: asOf } }],
            },
            include: { lineItems: true },
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        });
        return row ? toRecord(row) : null;
    }

    async create(data: CreateSubscriptionContractData): Promise<SubscriptionContractRecord> {
        const row = await this.db.subscriptionContract.create({
            data: {
                projectKey: data.projectKey,
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
        return toRecord(row);
    }

    async terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord> {
        const row = await this.db.subscriptionContract.update({
            where: { id: contractId },
            data: { effectiveUntil: data.effectiveUntil, status: data.status },
            include: { lineItems: true },
        });
        return toRecord(row);
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

function isPlainObject(value: unknown): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toUnknownArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
    return isPlainObject(value) ? (value as Record<string, unknown>) : null;
}

function toLineItem(row: ContractLineItemDbRow): ContractLineItemRecord {
    return {
        id: row.id,
        contractId: row.contractId,
        kind: row.kind as ContractLineItemKind,
        sourceKey: row.sourceKey,
        sourceVersionId: row.sourceVersionId,
        titleSnapshot: row.titleSnapshot,
        descriptionSnapshot: row.descriptionSnapshot,
        quantity: row.quantity,
        unit: row.unit,
        priceNet: Number(row.priceNet),
        priceGross: Number(row.priceGross),
        billingCycle: row.billingCycle as 'monthly' | 'yearly',
        minimumTermUntil: row.minimumTermUntil,
        featuresSnapshot: toStringArray(row.featuresSnapshot),
        quotaEffectsSnapshot: toQuotaMap(row.quotaEffectsSnapshot),
        metadata: toRecordOrNull(row.metadata),
        createdAt: row.createdAt,
    };
}

function toRecord(row: SubscriptionContractDbRow): SubscriptionContractRecord {
    return {
        id: row.id,
        projectKey: row.projectKey,
        tenantId: row.tenantId,
        status: row.status as SubscriptionContractStatus,
        effectiveFrom: row.effectiveFrom,
        effectiveUntil: row.effectiveUntil,
        originalOfferId: row.originalOfferId,
        originalPlanVersionId: row.originalPlanVersionId,
        originalBundleVersionIds: toStringArray(row.originalBundleVersionIds),
        entitlementSnapshot: isPlainObject(row.entitlementSnapshot)
            ? (row.entitlementSnapshot as EffectiveLimitsSnapshot)
            : null,
        priceSnapshot: row.priceSnapshot as SubscriptionContractPriceSnapshot,
        promotionSnapshots: toUnknownArray(row.promotionSnapshots),
        promoCodeSnapshots: toUnknownArray(row.promoCodeSnapshots),
        termsSnapshot: toRecordOrNull(row.termsSnapshot),
        lineItems: row.lineItems.map(toLineItem),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

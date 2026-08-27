import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
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
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { contractLineItems, subscriptionContracts } from './schema.js';

type ContractTableRow = typeof subscriptionContracts.$inferSelect;
type LineItemTableRow = typeof contractLineItems.$inferSelect;

/**
 * `SubscriptionContractRepository` against `subscription_contracts` and
 * `contract_line_items`.
 *
 * A contract is what a tenant agreed to, frozen: the plan version, the bundles,
 * the prices and the entitlements as they stood the moment it was signed. It is
 * **append-only** — the port offers `create` and `terminate` and nothing else,
 * and there is deliberately no update path here. A contract whose terms could be
 * edited afterwards is not evidence of anything, and the entitlement snapshot on
 * it is what a dispute is settled against.
 *
 * Ending one therefore means writing `effectiveUntil` and letting the active
 * lookup pass it by, not deleting or rewriting it. A replacement is a second
 * row, and the two are distinguished by their windows.
 */
@Injectable()
export class DrizzleSubscriptionContractRepository implements SubscriptionContractRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async list(filter: SubscriptionContractFilter): Promise<SubscriptionContractRecord[]> {
        const rows = await this.db
            .select()
            .from(subscriptionContracts)
            .where(
                and(
                    ...(filter.tenantId
                        ? [eq(subscriptionContracts.tenantId, filter.tenantId)]
                        : []),
                    ...(filter.status ? [eq(subscriptionContracts.status, filter.status)] : []),
                    ...(filter.asOf ? [inWindowAt(filter.asOf)] : []),
                ),
            )
            .orderBy(
                desc(subscriptionContracts.effectiveFrom),
                desc(subscriptionContracts.createdAt),
            );
        return this.withLineItems(this.db, rows);
    }

    async findById(contractId: string): Promise<SubscriptionContractRecord | null> {
        const rows = await this.db
            .select()
            .from(subscriptionContracts)
            .where(eq(subscriptionContracts.id, contractId))
            .limit(1);
        return (await this.withLineItems(this.db, rows))[0] ?? null;
    }

    async findActiveByTenantId(
        tenantId: string,
        asOf: Date = new Date(),
        tx?: TransactionContext,
    ): Promise<SubscriptionContractRecord | null> {
        // On the caller's transaction when it has one: this runs inside
        // `enforceLimit`'s interactive transaction, and drawing a second pool
        // connection there is how a request pool starves itself.
        const db = resolveDb(this.db, tx);
        const rows = await db
            .select()
            .from(subscriptionContracts)
            .where(
                and(
                    eq(subscriptionContracts.tenantId, tenantId),
                    inArray(subscriptionContracts.status, [
                        ...ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES,
                    ]),
                    inWindowAt(asOf),
                ),
            )
            .orderBy(
                desc(subscriptionContracts.effectiveFrom),
                desc(subscriptionContracts.createdAt),
            )
            .limit(1);
        return (await this.withLineItems(db, rows))[0] ?? null;
    }

    async create(data: CreateSubscriptionContractData): Promise<SubscriptionContractRecord> {
        const now = new Date();
        const contractId = randomUUID();
        // The contract and its lines are one document: a contract without its
        // line items prices nothing, and lines without their contract belong to
        // nobody. Both or neither.
        return this.db.transaction(async (transaction) => {
            const db = transaction as unknown as DrizzleClient;
            const rows = await db
                .insert(subscriptionContracts)
                .values({
                    id: contractId,
                    tenantId: data.tenantId,
                    status: data.status ?? 'active',
                    effectiveFrom: data.effectiveFrom,
                    effectiveUntil: data.effectiveUntil ?? null,
                    originalOfferId: data.originalOfferId ?? null,
                    originalPlanVersionId: data.originalPlanVersionId ?? null,
                    originalBundleVersionIds: data.originalBundleVersionIds ?? [],
                    entitlementSnapshot: data.entitlementSnapshot ?? null,
                    priceSnapshot: data.priceSnapshot,
                    promotionSnapshots: data.promotionSnapshots ?? [],
                    promoCodeSnapshots: data.promoCodeSnapshots ?? [],
                    termsSnapshot: data.termsSnapshot ?? null,
                    createdAt: now,
                    updatedAt: now,
                })
                .returning();
            const lineRows =
                data.lineItems.length === 0
                    ? []
                    : await db
                          .insert(contractLineItems)
                          .values(
                              data.lineItems.map((item) => toLineItemInsert(item, contractId, now)),
                          )
                          .returning();
            return toSubscriptionContractRecord(rows[0], lineRows);
        });
    }

    async terminate(
        contractId: string,
        data: TerminateSubscriptionContractData,
    ): Promise<SubscriptionContractRecord> {
        const rows = await this.db
            .update(subscriptionContracts)
            .set({
                effectiveUntil: data.effectiveUntil,
                // A null status leaves the column alone: the contract keeps
                // whatever it had — `active`, usually — and the new
                // `effectiveUntil` is what takes it out of the active lookup
                // once that moment arrives.
                ...(data.status === null ? {} : { status: data.status }),
                updatedAt: new Date(),
            })
            .where(eq(subscriptionContracts.id, contractId))
            .returning();
        if (!rows[0]) throw new Error(`SubscriptionContract '${contractId}' not found.`);
        return (await this.withLineItems(this.db, rows))[0];
    }

    /**
     * The lines for a batch of contracts in one query rather than one per
     * contract: `list` is the operator's contract history and would otherwise
     * be an N+1 over a table that only grows.
     */
    private async withLineItems(
        db: DrizzleClient,
        rows: ContractTableRow[],
    ): Promise<SubscriptionContractRecord[]> {
        if (rows.length === 0) return [];
        const lines = await db
            .select()
            .from(contractLineItems)
            .where(
                inArray(
                    contractLineItems.contractId,
                    rows.map((row) => row.id),
                ),
            );
        const byContract = new Map<string, LineItemTableRow[]>();
        for (const line of lines) {
            const bucket = byContract.get(line.contractId);
            if (bucket) bucket.push(line);
            else byContract.set(line.contractId, [line]);
        }
        return rows.map((row) => toSubscriptionContractRecord(row, byContract.get(row.id) ?? []));
    }
}

/** In force at `asOf`: started, and not yet ended. */
function inWindowAt(asOf: Date) {
    return and(
        lte(subscriptionContracts.effectiveFrom, asOf),
        or(
            isNull(subscriptionContracts.effectiveUntil),
            gt(subscriptionContracts.effectiveUntil, asOf),
        ),
    );
}

function toLineItemInsert(item: NewContractLineItemData, contractId: string, createdAt: Date) {
    return {
        id: randomUUID(),
        contractId,
        kind: item.kind,
        sourceKey: item.sourceKey,
        sourceVersionId: item.sourceVersionId ?? null,
        titleSnapshot: item.titleSnapshot,
        descriptionSnapshot: item.descriptionSnapshot ?? null,
        quantity: item.quantity,
        unit: item.unit ?? null,
        // Money as a decimal string all the way to the column: passing a JS
        // number here would round it on the way in, before anybody could
        // notice.
        priceNet: item.priceNet.toFixed(2),
        priceGross: item.priceGross.toFixed(2),
        billingCycle: item.billingCycle,
        minimumTermUntil: item.minimumTermUntil ?? null,
        featuresSnapshot: item.featuresSnapshot,
        quotaEffectsSnapshot: item.quotaEffectsSnapshot,
        metadata: item.metadata ?? null,
        createdAt,
    };
}

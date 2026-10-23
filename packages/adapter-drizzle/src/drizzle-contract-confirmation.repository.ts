import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or, type SQL } from 'drizzle-orm';
import type {
    ContractConfirmationRecord,
    ContractConfirmationRepository,
    ContractConfirmationStanding,
    NewContractConfirmationRendering,
    TransactionContext,
} from '@saasicat/core';
import { contractConfirmationChanged, toContractConfirmationRecord } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, resolveDb, type DrizzleClient } from './client.js';
import { contractConfirmations, subscriptionContracts } from './schema.js';

/** A page of ids, after `after` where it is given. */
type Page = { limit: number; after?: string };

type ConfirmationColumns = Partial<typeof contractConfirmations.$inferInsert>;

/**
 * `ContractConfirmationRepository` against `contract_confirmations`. Every
 * write but the first rendering is one conditional `UPDATE` that names the
 * state it expects, so a confirmation is archived once and mailed once however
 * many instances run; the first rendering is `INSERT … ON CONFLICT DO NOTHING`.
 */
@Injectable()
export class DrizzleContractConfirmationRepository implements ContractConfirmationRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    /** Writes `set` where the confirmation of `contractId` is in the state `conditions` name. */
    private async guarded(
        contractId: string,
        conditions: (SQL | undefined)[],
        set: ConfirmationColumns,
        tx?: TransactionContext,
    ): Promise<boolean> {
        const rows = await resolveDb(this.db, tx)
            .update(contractConfirmations)
            .set(set)
            .where(and(eq(contractConfirmations.contractId, contractId), ...conditions))
            .returning({ contractId: contractConfirmations.contractId });
        return rows.length === 1;
    }

    async recordRendering(
        contractId: string,
        rendering: NewContractConfirmationRendering,
        tx?: TransactionContext,
    ): Promise<ContractConfirmationRecord> {
        const db = resolveDb(this.db, tx);
        const [written] = await db
            .insert(contractConfirmations)
            .values({ contractId, ...rendering })
            .onConflictDoNothing({ target: contractConfirmations.contractId })
            .returning();
        const row = written ?? (await this.rowOf(contractId, tx));
        if (!row) throw new Error(`No confirmation of contract ${contractId} after recording it.`);
        if (row.checksum !== rendering.checksum) {
            throw contractConfirmationChanged(contractId, row.checksum, rendering.checksum);
        }
        return toContractConfirmationRecord(row);
    }

    async replaceRendering(
        contractId: string,
        rendering: NewContractConfirmationRendering,
        replaced: string,
        tx?: TransactionContext,
    ): Promise<ContractConfirmationRecord | null> {
        const [row] = await resolveDb(this.db, tx)
            .update(contractConfirmations)
            .set({ ...rendering })
            .where(
                and(
                    eq(contractConfirmations.contractId, contractId),
                    eq(contractConfirmations.checksum, replaced),
                    isNull(contractConfirmations.archivedAt),
                ),
            )
            .returning();
        return row ? toContractConfirmationRecord(row) : null;
    }

    markArchived(
        contractId: string,
        at: Date,
        checksum: string,
        tx?: TransactionContext,
    ): Promise<boolean> {
        return this.guarded(
            contractId,
            [
                eq(contractConfirmations.checksum, checksum),
                isNull(contractConfirmations.archivedAt),
            ],
            { archivedAt: at },
            tx,
        );
    }

    claimDelivery(
        contractId: string,
        at: Date,
        staleBefore: Date,
        tx?: TransactionContext,
    ): Promise<boolean> {
        // One conditional UPDATE: a second one waiting on the row's lock reads
        // the claim the first wrote, and takes nothing.
        return this.guarded(
            contractId,
            [
                isNotNull(contractConfirmations.archivedAt),
                isNull(contractConfirmations.deliveredAt),
                or(
                    isNull(contractConfirmations.deliveryClaimedAt),
                    lt(contractConfirmations.deliveryClaimedAt, staleBefore),
                ),
            ],
            { deliveryClaimedAt: at },
            tx,
        );
    }

    markDelivered(
        contractId: string,
        delivery: { claimedAt: Date; at: Date; to: string },
        tx?: TransactionContext,
    ): Promise<boolean> {
        return this.guarded(
            contractId,
            [
                isNotNull(contractConfirmations.archivedAt),
                isNull(contractConfirmations.deliveredAt),
                eq(contractConfirmations.deliveryClaimedAt, delivery.claimedAt),
            ],
            { deliveredAt: delivery.at, deliveredTo: delivery.to },
            tx,
        );
    }

    async releaseDelivery(
        contractId: string,
        claimedAt: Date,
        tx?: TransactionContext,
    ): Promise<void> {
        await this.guarded(
            contractId,
            [
                isNull(contractConfirmations.deliveredAt),
                eq(contractConfirmations.deliveryClaimedAt, claimedAt),
            ],
            { deliveryClaimedAt: null },
            tx,
        );
    }

    async find(
        contractId: string,
        tx?: TransactionContext,
    ): Promise<ContractConfirmationRecord | null> {
        const row = await this.rowOf(contractId, tx);
        return row ? toContractConfirmationRecord(row) : null;
    }

    async listAwaitingConfirmation(page: Page, tx?: TransactionContext): Promise<string[]> {
        const rows = await resolveDb(this.db, tx)
            .select({ id: subscriptionContracts.id })
            .from(subscriptionContracts)
            .leftJoin(
                contractConfirmations,
                eq(contractConfirmations.contractId, subscriptionContracts.id),
            )
            .where(
                and(
                    eq(subscriptionContracts.confirmationDue, true),
                    isNull(contractConfirmations.archivedAt),
                    page.after === undefined ? undefined : gt(subscriptionContracts.id, page.after),
                ),
            )
            .orderBy(asc(subscriptionContracts.id))
            .limit(page.limit);
        return rows.map((row) => row.id);
    }

    async listAwaitingDelivery(page: Page, tx?: TransactionContext): Promise<string[]> {
        const rows = await resolveDb(this.db, tx)
            .select({ contractId: contractConfirmations.contractId })
            .from(contractConfirmations)
            .where(
                and(
                    isNotNull(contractConfirmations.archivedAt),
                    isNull(contractConfirmations.deliveredAt),
                    page.after === undefined
                        ? undefined
                        : gt(contractConfirmations.contractId, page.after),
                ),
            )
            .orderBy(asc(contractConfirmations.contractId))
            .limit(page.limit);
        return rows.map((row) => row.contractId);
    }

    async listStandings(
        contractIds: readonly string[],
        tx?: TransactionContext,
    ): Promise<ContractConfirmationStanding[]> {
        if (contractIds.length === 0) return [];
        const rows = await resolveDb(this.db, tx)
            .select({
                contractId: subscriptionContracts.id,
                due: subscriptionContracts.confirmationDue,
                confirmation: contractConfirmations,
            })
            .from(subscriptionContracts)
            .leftJoin(
                contractConfirmations,
                eq(contractConfirmations.contractId, subscriptionContracts.id),
            )
            .where(inArray(subscriptionContracts.id, [...contractIds]))
            .orderBy(asc(subscriptionContracts.id));
        return rows.map((row) => ({
            contractId: row.contractId,
            due: row.due,
            confirmation: row.confirmation ? toContractConfirmationRecord(row.confirmation) : null,
        }));
    }

    private async rowOf(contractId: string, tx?: TransactionContext) {
        const [row] = await resolveDb(this.db, tx)
            .select()
            .from(contractConfirmations)
            .where(eq(contractConfirmations.contractId, contractId))
            .limit(1);
        return row;
    }
}

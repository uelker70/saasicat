import { Inject, Injectable } from '@nestjs/common';
import type {
    CanonicalContractConfirmationRow,
    ContractConfirmationRecord,
    ContractConfirmationRepository,
    ContractConfirmationStanding,
    NewContractConfirmationRendering,
    TransactionContext,
} from '@saasicat/core';
import { contractConfirmationChanged, toContractConfirmationRecord } from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the client: the confirmations, and the contracts they are due for. */
interface ConfirmationPrisma {
    contractConfirmation: PrismaModelDelegateLike<CanonicalContractConfirmationRow>;
    subscriptionContract: PrismaModelDelegateLike<{
        id: string;
        confirmationDue: boolean;
        confirmation: CanonicalContractConfirmationRow | null;
    }>;
}

/** Root-client fields used directly: the two delegates. */
interface ConfirmationRepositoryClient {
    contractConfirmation: unknown;
    subscriptionContract: unknown;
}

/** A page of ids, after `after` where it is given. */
type Page = { limit: number; after?: string };

/** The state of a confirmation a guarded write expects, as Prisma's `where` names it. */
interface ConfirmationGuard {
    checksum?: string;
    archivedAt?: null | { not: null };
    deliveredAt?: null;
    deliveryClaimedAt?: Date;
    OR?: readonly [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: Date } }];
}

/** The columns a guarded write sets. */
type ConfirmationWrite = Partial<Omit<CanonicalContractConfirmationRow, 'contractId'>>;

/**
 * `ContractConfirmationRepository` against `contract_confirmations`. Every
 * write but the first rendering is one conditional `updateMany` that names the
 * state it expects, so a confirmation is archived once and mailed once however
 * many instances run; the first rendering is `INSERT … ON CONFLICT DO NOTHING`.
 */
@Injectable()
export class PrismaContractConfirmationRepository implements ContractConfirmationRepository {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: ConfirmationRepositoryClient,
    ) {}

    private db(tx?: TransactionContext): ConfirmationPrisma {
        // SAFETY: a transaction client carries the delegates of the root
        // client, and both are generated from fragments 08 and 26, whose rows
        // the two delegate types name.
        return (tx ?? this.prisma) as ConfirmationPrisma;
    }

    /** Writes `data` where the confirmation of `contractId` is in the state `where` names. */
    private async guarded(
        contractId: string,
        where: ConfirmationGuard,
        data: ConfirmationWrite,
        tx?: TransactionContext,
    ): Promise<boolean> {
        const { count } = await this.db(tx).contractConfirmation.updateMany({
            where: { contractId, ...where },
            data,
        });
        return count === 1;
    }

    async recordRendering(
        contractId: string,
        rendering: NewContractConfirmationRendering,
        tx?: TransactionContext,
    ): Promise<ContractConfirmationRecord> {
        const confirmations = this.db(tx).contractConfirmation;
        const [written] = await confirmations.createManyAndReturn({
            data: [{ contractId, ...rendering }],
            skipDuplicates: true,
        });
        const row = written ?? (await confirmations.findUnique({ where: { contractId } }));
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
        const replacedNow = await this.guarded(
            contractId,
            { checksum: replaced, archivedAt: null },
            { ...rendering },
            tx,
        );
        return replacedNow ? this.find(contractId, tx) : null;
    }

    markArchived(
        contractId: string,
        at: Date,
        checksum: string,
        tx?: TransactionContext,
    ): Promise<boolean> {
        return this.guarded(contractId, { checksum, archivedAt: null }, { archivedAt: at }, tx);
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
            {
                archivedAt: { not: null },
                deliveredAt: null,
                OR: [{ deliveryClaimedAt: null }, { deliveryClaimedAt: { lt: staleBefore } }],
            },
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
            { archivedAt: { not: null }, deliveredAt: null, deliveryClaimedAt: delivery.claimedAt },
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
            { deliveredAt: null, deliveryClaimedAt: claimedAt },
            { deliveryClaimedAt: null },
            tx,
        );
    }

    async find(
        contractId: string,
        tx?: TransactionContext,
    ): Promise<ContractConfirmationRecord | null> {
        const row = await this.db(tx).contractConfirmation.findUnique({ where: { contractId } });
        return row ? toContractConfirmationRecord(row) : null;
    }

    async listAwaitingConfirmation(page: Page, tx?: TransactionContext): Promise<string[]> {
        const rows = await this.db(tx).subscriptionContract.findMany({
            where: {
                confirmationDue: true,
                id: page.after === undefined ? undefined : { gt: page.after },
                OR: [
                    { confirmation: { is: null } },
                    { confirmation: { is: { archivedAt: null } } },
                ],
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: page.limit,
        });
        return rows.map((row) => row.id);
    }

    async listAwaitingDelivery(page: Page, tx?: TransactionContext): Promise<string[]> {
        const rows = await this.db(tx).contractConfirmation.findMany({
            where: {
                contractId: page.after === undefined ? undefined : { gt: page.after },
                archivedAt: { not: null },
                deliveredAt: null,
            },
            select: { contractId: true },
            orderBy: { contractId: 'asc' },
            take: page.limit,
        });
        return rows.map((row) => row.contractId);
    }

    async listStandings(
        contractIds: readonly string[],
        tx?: TransactionContext,
    ): Promise<ContractConfirmationStanding[]> {
        if (contractIds.length === 0) return [];
        const rows = await this.db(tx).subscriptionContract.findMany({
            where: { id: { in: [...contractIds] } },
            select: { id: true, confirmationDue: true, confirmation: true },
            orderBy: { id: 'asc' },
        });
        return rows.map((row) => ({
            contractId: row.id,
            due: row.confirmationDue,
            confirmation: row.confirmation ? toContractConfirmationRecord(row.confirmation) : null,
        }));
    }
}

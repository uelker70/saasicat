import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type {
    ArchivedContractConfirmation,
    ContractConfirmationArchivePort,
    ContractConfirmationToArchive,
} from '@saasicat/core';
import {
    confirmationArchiveProtectionProblem,
    contractConfirmationChanged,
    toArchivedContractConfirmation,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { contractConfirmationArchive } from './schema.js';
import { triggerNamesOf } from './trigger-names.js';

/**
 * `ContractConfirmationArchivePort` against `contract_confirmation_archive`:
 * one file per contract, written once. The table's triggers refuse every
 * update, delete and truncate
 * (`1.0-a-contract-confirmation-is-archived.postgres.sql`), so nothing here
 * changes a confirmation once it is stored.
 */
@Injectable()
export class DrizzleContractConfirmationArchive implements ContractConfirmationArchivePort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async store(confirmation: ContractConfirmationToArchive): Promise<void> {
        const { contractId, checksum } = confirmation;
        // `ON CONFLICT DO NOTHING` on the contract: a file stored before stays,
        // and the one handed over now is compared with it by its checksum.
        const written = await this.db
            .insert(contractConfirmationArchive)
            .values({
                contractId,
                checksum,
                mediaType: confirmation.mediaType,
                fileName: confirmation.fileName,
                content: confirmation.content,
                archivedAt: confirmation.archivedAt,
            })
            .onConflictDoNothing({ target: contractConfirmationArchive.contractId })
            .returning({ contractId: contractConfirmationArchive.contractId });
        if (written.length > 0) return;
        const [stored] = await this.db
            .select({ checksum: contractConfirmationArchive.checksum })
            .from(contractConfirmationArchive)
            .where(eq(contractConfirmationArchive.contractId, contractId))
            .limit(1);
        if (stored && stored.checksum !== checksum) {
            throw contractConfirmationChanged(contractId, stored.checksum, checksum);
        }
    }

    async read(contractId: string): Promise<ArchivedContractConfirmation | null> {
        const [row] = await this.db
            .select()
            .from(contractConfirmationArchive)
            .where(eq(contractConfirmationArchive.contractId, contractId))
            .limit(1);
        return row ? toArchivedContractConfirmation(row) : null;
    }

    async protectionProblem(): Promise<string | null> {
        // Enabled is `O`, as triggers fire by default, or `A`, always; `D` is
        // disabled, and `R` fires only in a session that replicates.
        const result: unknown = await this.db.execute(sql`
            SELECT tgname::text AS "name" FROM pg_trigger
             WHERE tgrelid = to_regclass('contract_confirmation_archive')
               AND tgenabled IN ('O', 'A')`);
        return confirmationArchiveProtectionProblem(triggerNamesOf(result));
    }
}

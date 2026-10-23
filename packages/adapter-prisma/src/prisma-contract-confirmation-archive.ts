import { Inject, Injectable } from '@nestjs/common';
import type {
    ArchivedContractConfirmation,
    CanonicalContractConfirmationArchiveRow,
    ContractConfirmationArchivePort,
    ContractConfirmationToArchive,
} from '@saasicat/core';
import {
    confirmationArchiveProtectionProblem,
    contractConfirmationChanged,
    toArchivedContractConfirmation,
} from '@saasicat/core';
import {
    PRISMA_CLIENT_TOKEN,
    type PrismaModelDelegateLike,
    type PrismaTxLike,
} from './prisma-client-token.js';

/** Narrow view of the client: the one delegate the archive writes and reads, and the catalogue. */
interface ConfirmationArchivePrisma extends Pick<PrismaTxLike, '$queryRaw'> {
    contractConfirmationArchive: PrismaModelDelegateLike<CanonicalContractConfirmationArchiveRow>;
}

/** Root-client fields used directly: the archive's delegate and the raw query. */
interface ConfirmationArchiveClient extends Pick<PrismaTxLike, '$queryRaw'> {
    contractConfirmationArchive: unknown;
}

/**
 * `ContractConfirmationArchivePort` against `contract_confirmation_archive`:
 * one file per contract, written once. The table's triggers refuse every
 * update, delete and truncate
 * (`1.0-a-contract-confirmation-is-archived.postgres.sql`), so nothing here
 * changes a confirmation once it is stored.
 */
@Injectable()
export class PrismaContractConfirmationArchive implements ContractConfirmationArchivePort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: ConfirmationArchiveClient) {}

    private get db(): ConfirmationArchivePrisma {
        // SAFETY: `contractConfirmationArchive` is the delegate of fragment
        // 26's archive model, whose rows are
        // `CanonicalContractConfirmationArchiveRow`.
        return this.prisma as ConfirmationArchivePrisma;
    }

    async store(confirmation: ContractConfirmationToArchive): Promise<void> {
        const archive = this.db.contractConfirmationArchive;
        // `ON CONFLICT DO NOTHING` on the contract: a file stored before stays,
        // and the one handed over now is compared with it by its checksum.
        const written = await archive.createManyAndReturn({
            data: [
                {
                    contractId: confirmation.contractId,
                    checksum: confirmation.checksum,
                    mediaType: confirmation.mediaType,
                    fileName: confirmation.fileName,
                    content: confirmation.content,
                    archivedAt: confirmation.archivedAt,
                },
            ],
            skipDuplicates: true,
            select: { contractId: true },
        });
        if (written.length > 0) return;
        const stored = await archive.findUnique({
            where: { contractId: confirmation.contractId },
            select: { checksum: true },
        });
        if (stored && stored.checksum !== confirmation.checksum) {
            throw contractConfirmationChanged(
                confirmation.contractId,
                stored.checksum,
                confirmation.checksum,
            );
        }
    }

    async read(contractId: string): Promise<ArchivedContractConfirmation | null> {
        const row = await this.db.contractConfirmationArchive.findUnique({ where: { contractId } });
        return row ? toArchivedContractConfirmation(row) : null;
    }

    async protectionProblem(): Promise<string | null> {
        // Enabled is `O`, as triggers fire by default, or `A`, always; `D` is
        // disabled, and `R` fires only in a session that replicates.
        // SAFETY: the query selects one text column under the alias `name`.
        const rows = (await this.db.$queryRaw`
            SELECT tgname::text AS "name" FROM pg_trigger
             WHERE tgrelid = to_regclass('contract_confirmation_archive')
               AND tgenabled IN ('O', 'A')`) as Array<{ name: string }>;
        return confirmationArchiveProtectionProblem(rows.map((row) => row.name));
    }
}

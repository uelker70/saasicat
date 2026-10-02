import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalVersionRetirementRow,
    type NewVersionRetirement,
    type TransactionContext,
    type VersionRetirementRecord,
    type VersionRetirementRepository,
    toVersionRetirementRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the injected client used by this repository. */
interface VersionRetirementPrisma {
    versionRetirement: PrismaModelDelegateLike<CanonicalVersionRetirementRow>;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    retiredPlanVersionId: true,
    retiredPlanKey: true,
    retiredVersion: true,
    replacementPlanVersionId: true,
    replacementPlanKey: true,
    replacementVersion: true,
    announcedAt: true,
    announcedBy: true,
} as const;

/** `VersionRetirementRepository` against the canonical `version_retirements` table. */
@Injectable()
export class PrismaVersionRetirementRepository implements VersionRetirementRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: unknown) {}

    private client(tx?: TransactionContext): VersionRetirementPrisma {
        return (tx ?? this.prisma) as VersionRetirementPrisma;
    }

    async create(
        data: NewVersionRetirement,
        tx?: TransactionContext,
    ): Promise<VersionRetirementRecord> {
        const row = await this.client(tx).versionRetirement.create({
            data: {
                id: randomUUID(),
                retiredPlanVersionId: data.retired.planVersionId,
                retiredPlanKey: data.retired.planKey,
                retiredVersion: data.retired.version,
                replacementPlanVersionId: data.replacement.planVersionId,
                replacementPlanKey: data.replacement.planKey,
                replacementVersion: data.replacement.version,
                announcedAt: data.announcedAt,
                announcedBy: data.announcedBy,
            },
            select: COLUMNS,
        });
        return toVersionRetirementRecord(row);
    }

    async list(): Promise<VersionRetirementRecord[]> {
        const rows = await this.client().versionRetirement.findMany({
            select: COLUMNS,
            orderBy: [{ announcedAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toVersionRetirementRecord);
    }

    async findById(id: string): Promise<VersionRetirementRecord | null> {
        const row = await this.client().versionRetirement.findFirst({
            where: { id },
            select: COLUMNS,
        });
        return row ? toVersionRetirementRecord(row) : null;
    }
}

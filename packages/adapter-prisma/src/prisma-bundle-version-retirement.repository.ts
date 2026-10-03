import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalBundleVersionRetirementRow,
    type NewBundleVersionRetirement,
    type TransactionContext,
    type BundleVersionRetirementRecord,
    type BundleVersionRetirementRepository,
    toBundleVersionRetirementRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the injected client used by this repository. */
interface BundleVersionRetirementPrisma {
    bundleVersionRetirement: PrismaModelDelegateLike<CanonicalBundleVersionRetirementRow>;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    retiredBundleVersionId: true,
    retiredBundleKey: true,
    retiredVersion: true,
    replacementBundleVersionId: true,
    replacementBundleKey: true,
    replacementVersion: true,
    announcedAt: true,
    announcedBy: true,
} as const;

/** `BundleVersionRetirementRepository` against the canonical `bundle_version_retirements` table. */
@Injectable()
export class PrismaBundleVersionRetirementRepository implements BundleVersionRetirementRepository {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: unknown) {}

    private client(tx?: TransactionContext): BundleVersionRetirementPrisma {
        return (tx ?? this.prisma) as BundleVersionRetirementPrisma;
    }

    async create(
        data: NewBundleVersionRetirement,
        tx?: TransactionContext,
    ): Promise<BundleVersionRetirementRecord> {
        const row = await this.client(tx).bundleVersionRetirement.create({
            data: {
                id: randomUUID(),
                retiredBundleVersionId: data.retired.bundleVersionId,
                retiredBundleKey: data.retired.bundleKey,
                retiredVersion: data.retired.version,
                replacementBundleVersionId: data.replacement.bundleVersionId,
                replacementBundleKey: data.replacement.bundleKey,
                replacementVersion: data.replacement.version,
                announcedAt: data.announcedAt,
                announcedBy: data.announcedBy,
            },
            select: COLUMNS,
        });
        return toBundleVersionRetirementRecord(row);
    }

    async list(): Promise<BundleVersionRetirementRecord[]> {
        const rows = await this.client().bundleVersionRetirement.findMany({
            select: COLUMNS,
            orderBy: [{ announcedAt: 'desc' }, { id: 'desc' }],
        });
        return rows.map(toBundleVersionRetirementRecord);
    }

    async findById(id: string): Promise<BundleVersionRetirementRecord | null> {
        const row = await this.client().bundleVersionRetirement.findFirst({
            where: { id },
            select: COLUMNS,
        });
        return row ? toBundleVersionRetirementRecord(row) : null;
    }
}

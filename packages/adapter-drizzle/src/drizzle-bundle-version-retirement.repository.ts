import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
    type NewBundleVersionRetirement,
    type TransactionContext,
    type BundleVersionRetirementRecord,
    type BundleVersionRetirementRepository,
    toBundleVersionRetirementRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient, resolveDb } from './client.js';
import { bundleVersionRetirements } from './schema.js';

/** `BundleVersionRetirementRepository` against the canonical `bundle_version_retirements` table. */
@Injectable()
export class DrizzleBundleVersionRetirementRepository implements BundleVersionRetirementRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async create(
        data: NewBundleVersionRetirement,
        tx?: TransactionContext,
    ): Promise<BundleVersionRetirementRecord> {
        const [row] = await resolveDb(this.db, tx)
            .insert(bundleVersionRetirements)
            .values({
                id: randomUUID(),
                retiredBundleVersionId: data.retired.bundleVersionId,
                retiredBundleKey: data.retired.bundleKey,
                retiredVersion: data.retired.version,
                replacementBundleVersionId: data.replacement.bundleVersionId,
                replacementBundleKey: data.replacement.bundleKey,
                replacementVersion: data.replacement.version,
                announcedAt: data.announcedAt,
                announcedBy: data.announcedBy,
            })
            .returning();
        return toBundleVersionRetirementRecord(row!);
    }

    async list(): Promise<BundleVersionRetirementRecord[]> {
        const rows = await this.db
            .select()
            .from(bundleVersionRetirements)
            .orderBy(desc(bundleVersionRetirements.announcedAt), desc(bundleVersionRetirements.id));
        return rows.map(toBundleVersionRetirementRecord);
    }

    async findById(id: string): Promise<BundleVersionRetirementRecord | null> {
        const [row] = await this.db
            .select()
            .from(bundleVersionRetirements)
            .where(eq(bundleVersionRetirements.id, id));
        return row ? toBundleVersionRetirementRecord(row) : null;
    }
}

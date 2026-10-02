import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import {
    type NewVersionRetirement,
    type TransactionContext,
    type VersionRetirementRecord,
    type VersionRetirementRepository,
    toVersionRetirementRecord,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient, resolveDb } from './client.js';
import { versionRetirements } from './schema.js';

/** `VersionRetirementRepository` against the canonical `version_retirements` table. */
@Injectable()
export class DrizzleVersionRetirementRepository implements VersionRetirementRepository {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async create(
        data: NewVersionRetirement,
        tx?: TransactionContext,
    ): Promise<VersionRetirementRecord> {
        const [row] = await resolveDb(this.db, tx)
            .insert(versionRetirements)
            .values({
                id: randomUUID(),
                retiredPlanVersionId: data.retired.planVersionId,
                retiredPlanKey: data.retired.planKey,
                retiredVersion: data.retired.version,
                replacementPlanVersionId: data.replacement.planVersionId,
                replacementPlanKey: data.replacement.planKey,
                replacementVersion: data.replacement.version,
                announcedAt: data.announcedAt,
                announcedBy: data.announcedBy,
            })
            .returning();
        return toVersionRetirementRecord(row!);
    }

    async list(): Promise<VersionRetirementRecord[]> {
        const rows = await this.db
            .select()
            .from(versionRetirements)
            .orderBy(desc(versionRetirements.announcedAt), desc(versionRetirements.id));
        return rows.map(toVersionRetirementRecord);
    }

    async findById(id: string): Promise<VersionRetirementRecord | null> {
        const [row] = await this.db
            .select()
            .from(versionRetirements)
            .where(eq(versionRetirements.id, id));
        return row ? toVersionRetirementRecord(row) : null;
    }
}

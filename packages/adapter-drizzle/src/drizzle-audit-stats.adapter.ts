import { Inject, Injectable } from '@nestjs/common';
import { count, gte } from 'drizzle-orm';
import type { AuditStatsPort } from '@saasicat/types';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { auditLogs } from './schema.js';

/** `AuditStatsPort` against the canonical `audit_logs` table. */
@Injectable()
export class DrizzleAuditStatsAdapter implements AuditStatsPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async countSince(since: Date): Promise<number> {
        const rows = await this.db
            .select({ value: count() })
            .from(auditLogs)
            .where(gte(auditLogs.createdAt, since));
        return rows[0]?.value ?? 0;
    }
}

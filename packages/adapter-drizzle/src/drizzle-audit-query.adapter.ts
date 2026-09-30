import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lte } from 'drizzle-orm';
import type { AuditEntry, AuditQuery, AuditQueryPort } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, escapeLikePattern, type DrizzleClient } from './client.js';
import { auditLogs } from './schema.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

type AuditLogRow = typeof auditLogs.$inferSelect;

/**
 * `AuditQueryPort` against the canonical `audit_logs` table. Powers
 * `<app> audit tail` and the admin audit pages.
 */
@Injectable()
export class DrizzleAuditQueryAdapter implements AuditQueryPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async list(filter: AuditQuery): Promise<AuditEntry[]> {
        const page = Math.max(filter.page ?? 1, 1);
        const pageSize = Math.min(Math.max(filter.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

        const conditions = [
            filter.tenantId ? eq(auditLogs.tenantId, filter.tenantId) : undefined,
            filter.userId ? eq(auditLogs.userId, filter.userId) : undefined,
            filter.entity ? eq(auditLogs.entity, filter.entity) : undefined,
            filter.entityId ? eq(auditLogs.entityId, filter.entityId) : undefined,
            filter.action ? eq(auditLogs.action, filter.action) : undefined,
            toActorTagCondition(filter.actorTag),
            filter.from ? gte(auditLogs.createdAt, new Date(filter.from)) : undefined,
            filter.to ? lte(auditLogs.createdAt, new Date(filter.to)) : undefined,
        ];
        const rows = await this.db
            .select()
            .from(auditLogs)
            .where(and(...conditions))
            .orderBy(desc(auditLogs.createdAt))
            .limit(pageSize)
            .offset((page - 1) * pageSize);
        return (rows as AuditLogRow[]).map(toAuditEntry);
    }
}

/** The pattern `AuditQuery.actorTag` describes: a star at the start, the end or both. */
function toActorTagCondition(actorTag?: string) {
    if (!actorTag) return undefined;
    const leading = actorTag.startsWith('*');
    const trailing = actorTag.length > 1 && actorTag.endsWith('*');
    if (!leading && !trailing) return eq(auditLogs.actorTag, actorTag);
    const literal = actorTag.slice(leading ? 1 : 0, trailing ? -1 : undefined);
    return ilike(
        auditLogs.actorTag,
        `${leading ? '%' : ''}${escapeLikePattern(literal)}${trailing ? '%' : ''}`,
    );
}

function toAuditEntry(row: AuditLogRow): AuditEntry {
    return {
        id: row.id,
        tenantId: row.tenantId,
        userId: row.userId,
        // The schema does not persist the email — the actorTag carries it.
        userEmail: row.actorTag?.split(':')[1] ?? null,
        entity: row.entity,
        entityId: row.entityId,
        action: row.action,
        changes: (row.changes as Record<string, unknown> | null) ?? null,
        actorTag: row.actorTag,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt.toISOString(),
    };
}

import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditQuery, AuditQueryPort } from '@saasicat/types';
import {
    PRISMA_CLIENT_TOKEN,
    type AuditLogRowLike,
    type PrismaLike,
} from './prisma-client-token.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * `AuditQueryPort` against the canonical `audit_logs` table. Powers
 * `<app> audit tail` and the admin audit pages.
 */
@Injectable()
export class PrismaAuditQueryAdapter implements AuditQueryPort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async list(filter: AuditQuery): Promise<AuditEntry[]> {
        const page = Math.max(filter.page ?? 1, 1);
        const pageSize = Math.min(Math.max(filter.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

        const rows = await this.prisma.auditLog.findMany({
            where: {
                tenantId: filter.tenantId,
                userId: filter.userId,
                entity: filter.entity,
                entityId: filter.entityId,
                action: filter.action,
                actorTag: toActorTagFilter(filter.actorTag),
                createdAt:
                    filter.from || filter.to
                        ? {
                              gte: filter.from ? new Date(filter.from) : undefined,
                              lte: filter.to ? new Date(filter.to) : undefined,
                          }
                        : undefined,
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
        });
        return rows.map(toAuditEntry);
    }
}

function toActorTagFilter(actorTag?: string): string | { startsWith: string } | undefined {
    if (!actorTag) return undefined;
    if (actorTag.endsWith('*')) return { startsWith: actorTag.slice(0, -1) };
    return actorTag;
}

function toAuditEntry(row: AuditLogRowLike): AuditEntry {
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

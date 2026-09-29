import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry, AuditQuery, AuditQueryPort } from '@saasicat/core';
import {
    PRISMA_CLIENT_TOKEN,
    type AuditLogDelegateLike,
    type AuditLogRowLike,
} from './prisma-client-token.js';
import { literalInLike } from './like-pattern.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * `AuditQueryPort` against the canonical `audit_logs` table. Powers
 * `<app> audit tail` and the admin audit pages.
 */
@Injectable()
export class PrismaAuditQueryAdapter implements AuditQueryPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        // Reads only: a client whose `create` types `changes` as its own JSON
        // input would not satisfy the delegate's write.
        private readonly prisma: { auditLog: Pick<AuditLogDelegateLike, 'findMany'> },
    ) {}

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

function toActorTagFilter(actorTag?: string):
    | string
    | {
          startsWith?: string;
          endsWith?: string;
          contains?: string;
          mode?: 'insensitive';
      }
    | undefined {
    if (!actorTag) return undefined;
    if (actorTag.startsWith('*') && actorTag.endsWith('*')) {
        return { contains: literalInLike(actorTag.slice(1, -1)), mode: 'insensitive' };
    }
    if (actorTag.startsWith('*')) {
        return { endsWith: literalInLike(actorTag.slice(1)), mode: 'insensitive' };
    }
    if (actorTag.endsWith('*')) {
        return { startsWith: literalInLike(actorTag.slice(0, -1)), mode: 'insensitive' };
    }
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

import { Inject, Injectable } from '@nestjs/common';
import type { AuditStatsPort } from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type AuditLogDelegateLike } from './prisma-client-token.js';

/** `AuditStatsPort` against the canonical `audit_logs` table. */
@Injectable()
export class PrismaAuditStatsAdapter implements AuditStatsPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN)
        private readonly prisma: { auditLog: Pick<AuditLogDelegateLike, 'count'> },
    ) {}

    async countSince(since: Date): Promise<number> {
        return this.prisma.auditLog.count({ where: { createdAt: { gte: since } } });
    }
}

import { Inject, Injectable } from '@nestjs/common';
import type { AuditStatsPort } from '@saasicat/types';
import { PRISMA_CLIENT_TOKEN, type PrismaLike } from './prisma-client-token.js';

/** `AuditStatsPort` against the canonical `audit_logs` table. */
@Injectable()
export class PrismaAuditStatsAdapter implements AuditStatsPort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: PrismaLike) {}

    async countSince(since: Date): Promise<number> {
        return this.prisma.auditLog.count({ where: { createdAt: { gte: since } } });
    }
}

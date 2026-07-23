import { Injectable } from '@nestjs/common';
import type { UsageSnapshotPort } from '@saasicat/types';

import { PrismaService } from '../prisma/prisma.service';

/**
 * App-specific usage counter for the tenant billing UI (`GET /billing/usage`).
 * NotesApp declares a single quota — `notesMax` — so the snapshot counts the
 * tenant's notes, mirroring `NotesQuotaProvider.count`. A missing key would be
 * mapped to 0 by the platform controller, but returning it explicitly keeps the
 * usage bar accurate.
 */
@Injectable()
export class NotesUsageSnapshotPort implements UsageSnapshotPort {
    constructor(private readonly prisma: PrismaService) {}

    async snapshot(tenantId: string): Promise<Record<string, number>> {
        const notesMax = await this.prisma.note.count({ where: { tenantId } });
        return { notesMax };
    }
}

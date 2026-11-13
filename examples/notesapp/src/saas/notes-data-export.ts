import { Injectable } from '@nestjs/common';
import type { TenantDataExport, TenantDataExportPort } from '@saasicat/core';
import { PrismaService } from '../prisma/prisma.service';

const MEDIA_TYPE = 'application/json';

/**
 * A tenant's full export: everything the notes app keeps for the tenant — the
 * tenant itself, its users and its notes — as one JSON file. Its administrator
 * takes it from `GET billing/export` once the subscription has ended; the
 * platform asks for it on every download, for the tenant of the session only,
 * and records the download before it sends the file.
 *
 * The file is built whole in memory: the platform records a download only for
 * an export the application has finished producing.
 */
@Injectable()
export class NotesDataExport implements TenantDataExportPort {
    constructor(private readonly prisma: PrismaService) {}

    async export(tenantId: string): Promise<TenantDataExport> {
        const [tenant, users, notes] = await Promise.all([
            this.prisma.tenant.findUniqueOrThrow({
                where: { id: tenantId },
                select: { id: true, slug: true, name: true, createdAt: true },
            }),
            this.prisma.user.findMany({
                where: { tenantId },
                select: { id: true, email: true, createdAt: true },
                orderBy: { createdAt: 'asc' },
            }),
            this.prisma.note.findMany({
                where: { tenantId },
                select: { id: true, title: true, body: true, createdAt: true, updatedAt: true },
                orderBy: { createdAt: 'asc' },
            }),
        ]);
        return {
            content: new TextEncoder().encode(JSON.stringify({ tenant, users, notes }, null, 2)),
            mediaType: MEDIA_TYPE,
            fileName: `${tenant.slug}-export.json`,
        };
    }
}

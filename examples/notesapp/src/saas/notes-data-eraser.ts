import { Injectable } from '@nestjs/common';
import { assertOneTenant, type TenantCount, type TenantEraser } from '@saasicat/core';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Erases what the notes app keeps for a tenant in its database, on the day the
 * platform deletes the tenant: its audit entries, and its row, whose foreign
 * keys take its users, notes, subscription, add-on bookings and promo code
 * redemptions along. The notes app keeps no files; an app that does lists
 * their eraser before this one, since it finds the files through these rows.
 *
 * The subscriber's commercial record is not the tenant's to take: contracts,
 * charges, invoices, payments and credits name the tenant by value and hang
 * off the subscriber, so no foreign key reaches them from the tenant's row.
 * The platform counts that record after every eraser and stops the deletion
 * where one took any of it along.
 */
@Injectable()
export class NotesDataEraser implements TenantEraser {
    readonly name = 'notes-data';

    constructor(private readonly prisma: PrismaService) {}

    async count(tenantId: string): Promise<readonly TenantCount[]> {
        assertOneTenant(tenantId);
        const [notes, users, auditEntries] = await Promise.all([
            this.prisma.note.count({ where: { tenantId } }),
            this.prisma.user.count({ where: { tenantId } }),
            this.prisma.auditLog.count({ where: { tenantId } }),
        ]);
        return [
            { category: 'notes', count: notes },
            { category: 'users', count: users },
            { category: 'audit-entries', count: auditEntries },
        ];
    }

    async erase(tenantId: string): Promise<void> {
        assertOneTenant(tenantId);
        // The audit entries go before the row: an audit log that refers to its
        // tenant by a foreign key refuses the row's deletion while they remain.
        // `deleteMany` rather than `delete`, because the platform calls again
        // when an answer was lost, and a tenant already gone is done; one
        // transaction, so a call that fails leaves the tenant as it was.
        await this.prisma.$transaction(async (tx) => {
            await tx.auditLog.deleteMany({ where: { tenantId } });
            await tx.tenant.deleteMany({ where: { id: tenantId } });
        });
    }
}

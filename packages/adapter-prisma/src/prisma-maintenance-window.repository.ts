import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
    type CanonicalMaintenanceWindowRow,
    type MaintenanceWindowChanges,
    type MaintenanceWindowPort,
    type MaintenanceWindowRecord,
    type MaintenanceWindowStage,
    type NewMaintenanceWindow,
    toMaintenanceWindowRecord,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the injected client used by this repository. */
interface MaintenanceWindowPrisma {
    maintenanceWindow: PrismaModelDelegateLike<CanonicalMaintenanceWindowRow> & {
        createManyAndReturn(args: {
            data: CanonicalMaintenanceWindowRow[];
            skipDuplicates: boolean;
        }): Promise<CanonicalMaintenanceWindowRow[]>;
    };
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    id: true,
    startsAt: true,
    endsAt: true,
    message: true,
    createdAt: true,
    createdBy: true,
    lockedAt: true,
    lockedBy: true,
    endedAt: true,
    endedBy: true,
} as const;

/** `MaintenanceWindowPort` against the canonical `maintenance_windows` table. */
@Injectable()
export class PrismaMaintenanceWindowRepository implements MaintenanceWindowPort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: unknown) {}

    private get db(): MaintenanceWindowPrisma {
        return this.prisma as MaintenanceWindowPrisma;
    }

    async findOpen(): Promise<MaintenanceWindowRecord | null> {
        const row = await this.db.maintenanceWindow.findFirst({
            where: { endedAt: null },
            select: COLUMNS,
        });
        return row ? toMaintenanceWindowRecord(row) : null;
    }

    async listRecent(limit: number): Promise<MaintenanceWindowRecord[]> {
        const rows = await this.db.maintenanceWindow.findMany({
            select: COLUMNS,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit,
        });
        return rows.map(toMaintenanceWindowRecord);
    }

    /**
     * One statement, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the
     * partial unique index that holds an installation to one open window is
     * what refuses the second, and it refuses by returning no row rather than
     * by raising. The id is a uuid made here, so the primary key cannot be the
     * key it met.
     */
    async open(window: NewMaintenanceWindow): Promise<MaintenanceWindowRecord | null> {
        const [row] = await this.db.maintenanceWindow.createManyAndReturn({
            data: [{ id: randomUUID(), ...window, endedAt: null, endedBy: null }],
            skipDuplicates: true,
        });
        return row ? toMaintenanceWindowRecord(row) : null;
    }

    /**
     * One guarded `UPDATE`: the stage the caller read is in the `WHERE`, so a
     * window another operator moved on a moment earlier leaves the count at
     * zero instead of being moved twice.
     */
    async update(
        id: string,
        stage: MaintenanceWindowStage,
        changes: MaintenanceWindowChanges,
    ): Promise<MaintenanceWindowRecord | null> {
        const { count } = await this.db.maintenanceWindow.updateMany({
            where: {
                id,
                endedAt: null,
                lockedAt: stage === 'locked' ? { not: null } : null,
            },
            data: changes,
        });
        if (count !== 1) return null;
        const row = await this.db.maintenanceWindow.findUnique({
            where: { id },
            select: COLUMNS,
        });
        return row ? toMaintenanceWindowRecord(row) : null;
    }
}

import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { InstallationMark, InstallationMarkPort } from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { installationMarks } from './schema.js';

/**
 * The one row `installation_marks` holds: the column default in the canonical
 * schema and the value the `CHECK` in `constraints.postgres.sql` allows.
 */
const INSTALLATION_ROW_ID = 'installation';

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    identifier: installationMarks.identifier,
    markedAt: installationMarks.markedAt,
    markedBy: installationMarks.markedBy,
};

/** `InstallationMarkPort` against the canonical `installation_marks` table. */
@Injectable()
export class DrizzleInstallationMarkRepository implements InstallationMarkPort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async find(): Promise<InstallationMark | null> {
        const [row] = await this.db
            .select(COLUMNS)
            .from(installationMarks)
            .where(eq(installationMarks.id, INSTALLATION_ROW_ID));
        return row ?? null;
    }

    /**
     * `ON CONFLICT DO NOTHING` on the primary key: the fixed id is what refuses
     * a second mark, and of two marks issued at once the later waits for the
     * earlier and then writes nothing. The read afterwards answers the mark
     * that stands, whichever landed.
     */
    async markIfUnmarked(mark: InstallationMark): Promise<InstallationMark> {
        await this.db
            .insert(installationMarks)
            .values({ id: INSTALLATION_ROW_ID, ...toMark(mark) })
            .onConflictDoNothing({ target: installationMarks.id });
        const standing = await this.find();
        if (standing === null) {
            // Nothing in the port removes the row, so only a hand outside the
            // platform can have deleted it between the insert and the read.
            throw new Error(
                'installation_marks holds no row right after a mark was written: ' +
                    'something outside the platform removed it.',
            );
        }
        return standing;
    }

    /**
     * One guarded `UPDATE`: the identifier the caller read is in the `WHERE`,
     * so a mark somebody replaced a moment earlier returns no row instead of
     * being replaced twice.
     */
    async replace(current: string, mark: InstallationMark): Promise<InstallationMark | null> {
        const [row] = await this.db
            .update(installationMarks)
            .set(toMark(mark))
            .where(
                and(
                    eq(installationMarks.id, INSTALLATION_ROW_ID),
                    eq(installationMarks.identifier, current),
                ),
            )
            .returning(COLUMNS);
        return row ?? null;
    }
}

function toMark(mark: InstallationMark): InstallationMark {
    return { identifier: mark.identifier, markedAt: mark.markedAt, markedBy: mark.markedBy };
}

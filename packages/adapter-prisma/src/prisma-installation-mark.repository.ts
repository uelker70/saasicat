import { Inject, Injectable } from '@nestjs/common';
import type { InstallationMark, InstallationMarkPort } from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/**
 * The one row `installation_marks` holds. It is the column default in the
 * canonical schema and the value the `CHECK` in `constraints.postgres.sql`
 * allows, so a second insert collides with the primary key and a caller that
 * supplies another id is refused by the database.
 */
const INSTALLATION_ROW_ID = 'installation';

interface InstallationMarkDbRow {
    identifier: string;
    testOperation: boolean;
    markedAt: Date;
    markedBy: string;
}

/** Narrow view of the injected client used by this repository. */
interface InstallationMarkPrisma {
    installationMark: PrismaModelDelegateLike<InstallationMarkDbRow>;
}

/**
 * What the constructor takes: a client that has the delegate. A client
 * generated from a schema without fragment 32 fails to compile here rather
 * than at the first mark.
 */
interface InstallationMarkRepositoryClient {
    installationMark: unknown;
}

/** The columns a read asks for, named, so a column a later release adds is not read. */
const COLUMNS = {
    identifier: true,
    testOperation: true,
    markedAt: true,
    markedBy: true,
} as const;

/** `InstallationMarkPort` against the canonical `installation_marks` table. */
@Injectable()
export class PrismaInstallationMarkRepository implements InstallationMarkPort {
    constructor(
        @Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: InstallationMarkRepositoryClient,
    ) {}

    private get db(): InstallationMarkPrisma {
        // SAFETY: `installationMark` is the delegate of fragment 32's model,
        // whose rows carry the columns `InstallationMarkDbRow` names; the
        // bundle hands this repository the canonical client.
        return this.prisma as InstallationMarkPrisma;
    }

    async find(): Promise<InstallationMark | null> {
        const row = await this.db.installationMark.findUnique({
            where: { id: INSTALLATION_ROW_ID },
            select: COLUMNS,
        });
        return row ? toMark(row) : null;
    }

    /**
     * One insert, `skipDuplicates` being `ON CONFLICT DO NOTHING`: the primary
     * key on the fixed id is what refuses a second mark, and of two marks
     * issued at once the later waits for the earlier and then writes nothing.
     * The read afterwards answers the mark that stands, whichever landed.
     */
    async markIfUnmarked(mark: InstallationMark): Promise<InstallationMark> {
        await this.db.installationMark.createMany({
            data: [{ id: INSTALLATION_ROW_ID, ...toMark(mark) }],
            skipDuplicates: true,
        });
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
     * One guarded `UPDATE`: the identifier and the operation the caller read
     * are in the `WHERE`, so a mark somebody changed a moment earlier leaves
     * the count at zero instead of being changed twice. The answer is the mark
     * as written, not a read afterwards, which could already be a later
     * replacement's.
     */
    async replace(
        current: Pick<InstallationMark, 'identifier' | 'testOperation'>,
        mark: InstallationMark,
    ): Promise<InstallationMark | null> {
        const written = toMark(mark);
        const { count } = await this.db.installationMark.updateMany({
            where: {
                id: INSTALLATION_ROW_ID,
                identifier: current.identifier,
                testOperation: current.testOperation,
            },
            data: written,
        });
        return count === 1 ? written : null;
    }
}

function toMark(row: InstallationMarkDbRow): InstallationMark {
    return {
        identifier: row.identifier,
        testOperation: row.testOperation,
        markedAt: row.markedAt,
        markedBy: row.markedBy,
    };
}

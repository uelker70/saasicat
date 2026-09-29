import type { PersistenceRefusal } from '@saasicat/core';

/**
 * What an insert that `skipDuplicates` skipped ran into.
 *
 * Prisma cannot aim the conflict at one index, so the key is looked up: where
 * it is taken, that is the platform's case, refused with its code; where it is
 * not, a unique index of the application's own refused the row, and that is
 * the application's to report rather than a key somebody else took.
 */
export async function refusalOfSkippedInsert(
    keyIsTaken: () => Promise<boolean>,
    taken: () => PersistenceRefusal,
    what: string,
): Promise<Error> {
    if (await keyIsTaken()) return taken();
    return new Error(`${what} was not created: a unique index other than its key refused the row.`);
}

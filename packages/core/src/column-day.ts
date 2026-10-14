// A calendar day read back from a column, shared by the mappings that read
// one: a Prisma `@db.Date` column comes back as a `Date` at midnight UTC, a
// Drizzle `date` column in string mode as the text itself.

import type { CalendarDay } from './zoned-day.js';

/** Which column of which row a value came from, for the error that names it. */
export interface ColumnWhere {
    table: string;
    column: string;
    id: string;
}

const DAY_LENGTH = 'YYYY-MM-DD'.length;

/** The day a `date` column holds; throws, naming the column, for anything else. */
export function dayOf(value: unknown, where: ColumnWhere): CalendarDay {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, DAY_LENGTH);
    }
    if (
        typeof value === 'string' &&
        value.length === DAY_LENGTH &&
        !Number.isNaN(Date.parse(value))
    ) {
        return value;
    }
    throw new Error(`${where.table}.${where.column} of ${where.id} is not a day.`);
}

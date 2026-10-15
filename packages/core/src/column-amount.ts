// An amount read back from a `numeric` column: a Prisma row carries a
// `Decimal`, a Drizzle row the numeric text.

import type { ColumnWhere } from './column-day.js';

/** The amount a `numeric` column holds; throws, naming the column, for anything else. */
export function columnAmountOf(value: unknown, where: ColumnWhere): number {
    // oxlint-disable-next-line typescript/no-base-to-string -- Prisma hands a Decimal, whose text is the number; any other object becomes NaN and is refused below
    const amount = Number(value === null || value === undefined ? NaN : String(value));
    if (!Number.isFinite(amount)) {
        throw new Error(`${where.table}.${where.column} of ${where.id} is not an amount.`);
    }
    return amount;
}

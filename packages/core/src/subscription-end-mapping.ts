// Canonical row -> end mapping for subscription ends. Pure, and shared by both
// adapters for the reason `subscription-contract-mapping.ts` gives.

import { dayOf } from './column-day.js';
import type { SubscriptionEnd } from './subscription-end.types.js';

/**
 * A `subscription_ends` row as either adapter reads it back: `deletesOn` is a
 * `Date` at midnight UTC from Prisma's `@db.Date`, the text itself from
 * Drizzle's `date` in string mode.
 */
export type CanonicalSubscriptionEndRow = Omit<SubscriptionEnd, 'deletesOn'> & {
    deletesOn: unknown;
};

/** Reads a row back as an end, naming each column rather than spreading the row. */
export function toSubscriptionEnd(row: CanonicalSubscriptionEndRow): SubscriptionEnd {
    return {
        id: row.id,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        endsAt: row.endsAt,
        deletesOn: dayOf(row.deletesOn, {
            table: 'subscription_ends',
            column: 'deletesOn',
            id: row.id,
        }),
        recordedAt: row.recordedAt,
        recordedBy: row.recordedBy,
    };
}

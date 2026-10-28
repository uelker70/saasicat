// A `subscriber_joins` row as both adapters read it, and what they read it into.

import {
    SUBSCRIBER_OWNED_TABLES,
    type SubscriberJoinMoves,
    type SubscriberJoinRecord,
} from './subscriber-join.types.js';

/** A `subscriber_joins` row with the columns every adapter selects. */
export interface CanonicalSubscriberJoinRow {
    id: string;
    fromSubscriberId: string;
    intoSubscriberId: string;
    reason: string;
    joinedBy: string;
    joinedAt: Date;
    digest: string;
    moved: unknown;
}

/**
 * What moved, read back from its JSON column: every table it names that names
 * a subscriber, with a whole count. Anything else is left out rather than
 * passed on as a count nobody can read.
 */
export function toSubscriberJoinMoves(value: unknown): SubscriberJoinMoves {
    const moves: SubscriberJoinMoves = {};
    if (typeof value !== 'object' || value === null) return moves;
    for (const { table } of SUBSCRIBER_OWNED_TABLES) {
        const count: unknown = Object.getOwnPropertyDescriptor(value, table)?.value;
        if (typeof count === 'number' && Number.isInteger(count) && count >= 0)
            moves[table] = count;
    }
    return moves;
}

export function toSubscriberJoinRecord(row: CanonicalSubscriberJoinRow): SubscriberJoinRecord {
    return {
        id: row.id,
        fromSubscriberId: row.fromSubscriberId,
        intoSubscriberId: row.intoSubscriberId,
        reason: row.reason,
        joinedBy: row.joinedBy,
        joinedAt: row.joinedAt,
        digest: row.digest,
        moved: toSubscriberJoinMoves(row.moved),
    };
}

/** Why a join wrote another number of rows than it counted for `table`, as an error to throw. */
export function subscriberJoinMovedOtherwise(table: string, counted: number, moved: number): Error {
    return new Error(
        `Joining subscribers moved ${moved} rows of ${table}, where it counted ${counted}; nothing ` +
            'was written. A row-level policy hiding rows from the platform moves fewer: the join ' +
            'runs in the bypass the platform reads across tenants with.',
    );
}

// The in-memory harness has no database whose triggers refuse a row for a
// subscriber joined into another, so it refuses one itself, before every row
// it writes into a table that names a subscriber — which is what lets its
// `protectionProblem` answer nothing. The contract's scenarios write into two
// of those tables after a join; this holds the other writes to the same rule,
// so a write added without the refusal cannot leave the self-test passing
// over a harness that no longer guards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SUBSCRIBER_OWNED_TABLES } from '@saasicat/core';

import { MEMORY_ROWS_OF_TABLE } from './support/memory-harness.js';

const SOURCE = readFileSync(new URL('./support/memory-harness.js', import.meta.url), 'utf8');
const REFUSAL = 'refuseARowForAJoinedSubscriber(';

/** The line before the one `offset` sits in, without its indentation. */
const lineBefore = (offset) => {
    const lineStart = SOURCE.lastIndexOf('\n', offset);
    return SOURCE.slice(SOURCE.lastIndexOf('\n', lineStart - 1) + 1, lineStart).trim();
};

test('the harness keeps every table that names a subscriber', () => {
    assert.deepEqual(
        Object.keys(MEMORY_ROWS_OF_TABLE).sort(),
        SUBSCRIBER_OWNED_TABLES.map(({ table }) => table).sort(),
    );
});

test('every row it writes into one of them is refused for a joined subscriber first', () => {
    const unguarded = [];
    for (const [table, rows] of Object.entries(MEMORY_ROWS_OF_TABLE)) {
        const write = `state.${rows}.push(`;
        let writes = 0;
        for (let at = SOURCE.indexOf(write); at !== -1; at = SOURCE.indexOf(write, at + 1)) {
            writes += 1;
            if (!lineBefore(at).startsWith(`${REFUSAL}'${table}', `)) {
                unguarded.push(`${table} at offset ${at}`);
            }
        }
        // A table the harness never writes would make this test true of nothing.
        assert.ok(writes > 0, `the harness writes no row of ${table} the way this test reads`);
    }
    assert.deepEqual(unguarded, []);
});

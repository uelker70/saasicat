// The arithmetic behind the drag handle in the marketing list, tested where it
// is cheap: the function is framework-free, so a mounted row is not needed to
// find out what a move costs in writes.

// @requirement SC-PLAN-024 — The order plans appear in is set by moving them, not by typing numbers

import { deepStrictEqual } from 'node:assert/strict';
import { describe, test } from 'node:test';

import { reorderedPriorities } from '../dist/client/index.js';

/** The order the list would render, given the priorities it holds. */
function orderOf(priorities) {
    return priorities
        .map((priority, index) => ({ priority, index }))
        .sort((a, b) => b.priority - a.priority || a.index - b.index)
        .map((row) => row.index);
}

/** Applies what the function returns, the way the page applies it. */
function applied(priorities, updates) {
    return priorities.map((priority, index) => updates[index] ?? priority);
}

describe('reorderedPriorities', () => {
    test('a move within equal priorities produces the order it promises', () => {
        const before = [0, 0, 0];
        const updates = reorderedPriorities(before, 2, 0);

        deepStrictEqual(orderOf(applied(before, updates)), [2, 0, 1]);
    });

    test('it keeps the gaps an operator chose', () => {
        // 100 / 50 / 10 stay 100 / 50 / 10 — only who holds them changes.
        const before = [100, 50, 10];
        const updates = reorderedPriorities(before, 0, 2);
        const after = applied(before, updates);

        deepStrictEqual(
            [...after].sort((a, b) => b - a),
            [100, 50, 10],
        );
        deepStrictEqual(orderOf(after), [1, 2, 0]);
    });

    test('rows that keep their value are reported as unchanged', () => {
        // The bottom row is untouched by a swap at the top, and every reported
        // change is one HTTP write.
        deepStrictEqual(reorderedPriorities([30, 20, 10], 0, 1), [20, 30, null]);
    });

    test('no move, no writes', () => {
        deepStrictEqual(reorderedPriorities([2, 1], 1, 1), [null, null]);
        deepStrictEqual(reorderedPriorities([2, 1], 5, 0), [null, null]);
    });

    test('a value at the top of the range stays inside it', () => {
        // Lifting the whole run to clear the ties used to push 9999 to 10001,
        // which the API refuses with a 400 — so the drag could not be saved at
        // all on a list whose top plan sits near the maximum.
        const before = [9999, 0, 0, 0];
        const after = applied(before, reorderedPriorities(before, 3, 0));

        deepStrictEqual(
            after.every((value) => value >= 0 && value <= 10_000),
            true,
        );
        deepStrictEqual(orderOf(after), [3, 0, 1, 2]);
    });

    test('a list already at the ceiling still separates', () => {
        const before = [10_000, 10_000, 10_000];
        const after = applied(before, reorderedPriorities(before, 2, 0));

        deepStrictEqual(
            after.every((value) => value >= 0 && value <= 10_000),
            true,
        );
        deepStrictEqual(new Set(after).size, 3);
        deepStrictEqual(orderOf(after), [2, 0, 1]);
    });

    test('pulling ties apart never goes below zero', () => {
        // `min` is a valid priority; a negative one is a value the number field
        // this replaced would have refused.
        const updates = reorderedPriorities([0, 0, 0, 0], 3, 0);

        deepStrictEqual(
            applied([0, 0, 0, 0], updates).every((value) => value >= 0),
            true,
        );
    });

    test('a move to the end lands at the end', () => {
        const before = [5, 4, 3, 2];
        const after = applied(before, reorderedPriorities(before, 0, 3));

        deepStrictEqual(orderOf(after), [1, 2, 3, 0]);
    });
});

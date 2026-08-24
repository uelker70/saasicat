import { MARKETING_PRIORITY_MAX, MARKETING_PRIORITY_MIN } from '@saasicat/core';

/**
 * The priority values that turn a drag into a new order.
 *
 * The marketing list sorts by priority descending, so "move this row here" has
 * to be expressed as numbers before it can be persisted. Two things make that
 * more than an assignment:
 *
 * - **Ties.** Every plan starts at `0`, and swapping two zeroes changes
 *   nothing. The values have to be pulled apart before they can carry an order.
 * - **Existing values mean something.** An operator who set 100 / 50 / 10 chose
 *   those gaps. Renumbering to 3 / 2 / 1 would answer a question nobody asked,
 *   so the values are kept and only their assignment moves.
 *
 * The result is per ORIGINAL index, and `null` where a row keeps what it has —
 * each change is one write, so not changing is worth reporting.
 */
export function reorderedPriorities(
    priorities: readonly number[],
    from: number,
    to: number,
): (number | null)[] {
    const count = priorities.length;
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) {
        return priorities.map(() => null);
    }

    const order = priorities.map((_, index) => index);
    order.splice(to, 0, ...order.splice(from, 1));

    const values = descendingDistinct(priorities);
    const next: (number | null)[] = priorities.map(() => null);
    order.forEach((originalIndex, position) => {
        const value = values[position]!;
        if (value !== priorities[originalIndex]) next[originalIndex] = value;
    });
    return next;
}

/**
 * The same values, sorted high to low, pulled apart where they were equal, and
 * kept inside the range the API accepts.
 *
 * Three passes, and each exists because one of the other two can break its
 * bound:
 *
 * 1. **Room above.** The entry at position `i` has `i` entries above it, each
 *    of which must be strictly larger, so it cannot exceed `MAX - i`.
 * 2. **Strictly decreasing.** Pushing each entry below its predecessor keeps
 *    every gap the operator chose and spends only what a tie costs.
 * 3. **Room below.** That push can go under zero — `[0, 0, 0]` becomes
 *    `[0, -1, -2]` — so an entry with `n - 1 - i` entries below it is raised to
 *    at least that. Raising from the bottom rather than lifting the whole run
 *    is what keeps a value at the top of the range where it was: lifting turned
 *    `[9999, 0, 0, 0]` into `[10001, 2, 1, 0]`, and the API refuses `10001`.
 *
 * Pass 3 cannot undo pass 1 or 2: `n - 1 - i` is itself strictly decreasing, so
 * the maximum of two strictly decreasing sequences is one, and it stays under
 * `MAX - i` for any list shorter than half the range.
 */
function descendingDistinct(priorities: readonly number[]): number[] {
    const values = [...priorities].sort((a, b) => b - a);
    const count = values.length;

    for (let i = 0; i < count; i++) {
        values[i] = Math.min(values[i]!, MARKETING_PRIORITY_MAX - i);
    }
    for (let i = 1; i < count; i++) {
        values[i] = Math.min(values[i]!, values[i - 1]! - 1);
    }
    for (let i = count - 1; i >= 0; i--) {
        values[i] = Math.max(values[i]!, MARKETING_PRIORITY_MIN + (count - 1 - i));
    }
    return values;
}

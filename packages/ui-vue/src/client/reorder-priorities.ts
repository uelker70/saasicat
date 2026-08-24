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
 * The same values, sorted high to low and pulled apart where they were equal.
 *
 * Walking downwards and pushing each value below its predecessor keeps every
 * gap the operator chose and only spends what a tie costs. That can push the
 * tail below zero — `[0, 0, 0]` becomes `[0, -1, -2]` — so the run is lifted
 * back afterwards rather than clamped, which would re-create the tie it just
 * removed.
 */
function descendingDistinct(priorities: readonly number[]): number[] {
    const values = [...priorities].sort((a, b) => b - a);
    for (let i = 1; i < values.length; i++) {
        values[i] = Math.min(values[i]!, values[i - 1]! - 1);
    }
    const lowest = values[values.length - 1] ?? 0;
    if (lowest >= 0) return values;
    return values.map((value) => value - lowest);
}

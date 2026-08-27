// Framework-free: no Vue, no DOM, no network. See the tenant package README for
// why logic leaves the SFCs.

/**
 * Wraps an async lookup so that only the answer to the **current** question is
 * committed.
 *
 * Two lookups can be in flight at once — a plan change while the first is still
 * out — and the slower one is not necessarily the older question. Committing
 * whatever lands last leaves the previous answer standing until something else
 * moves, which for a price means a figure resolved against a plan the tenant is
 * no longer on.
 *
 * Each call takes the next number and only commits while it still holds it. A
 * superseded call resolves without doing anything, so a caller cannot tell the
 * difference except by what it does not see.
 */
export function latestAnswerWins<TArgs extends unknown[], TResult>(
    lookup: (...args: TArgs) => Promise<TResult>,
    commit: (result: TResult) => void,
): (...args: TArgs) => Promise<void> {
    let current = 0;
    return async (...args: TArgs) => {
        const generation = (current += 1);
        const result = await lookup(...args);
        if (generation === current) commit(result);
    };
}

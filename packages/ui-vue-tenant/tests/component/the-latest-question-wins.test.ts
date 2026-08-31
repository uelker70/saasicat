// @requirement SC-UI-018 — Where two answers are outstanding, the current question's answer wins

import { describe, expect, test } from 'vitest';

import { latestAnswerWins } from '../../src/latest-answer-wins.js';

// Which answer is allowed to land.
//
// Prices are resolved against a plan, so an answer for a plan the tenant has
// since left is not stale — it is about a different question. The slower
// response is not necessarily the older one, which is why "last write wins"
// silently shows the wrong plan's figures.

/** A lookup whose answers are released by hand, in whatever order the test wants. */
function deferrable() {
    const releases: Array<() => void> = [];
    const lookup = (label: string) =>
        new Promise<string>((resolve) => {
            releases.push(() => resolve(label));
        });
    return { lookup, release: (index: number) => releases[index]() };
}

describe('only the current question commits its answer', () => {
    test('a slower earlier answer does not overwrite a faster later one', async () => {
        const committed: string[] = [];
        const { lookup, release } = deferrable();
        const run = latestAnswerWins(lookup, (v: string) => committed.push(v));

        const first = run('old plan');
        const second = run('new plan');
        // The later question answers first, then the earlier one arrives.
        release(1);
        release(0);
        await Promise.all([first, second]);

        expect(committed).toEqual(['new plan']);
    });

    test('answers in order still commit only the last', async () => {
        const committed: string[] = [];
        const { lookup, release } = deferrable();
        const run = latestAnswerWins(lookup, (v: string) => committed.push(v));

        const first = run('old plan');
        release(0);
        await first;
        const second = run('new plan');
        release(1);
        await second;

        expect(committed).toEqual(['old plan', 'new plan']);
    });

    test('a single question commits, so the guard does not swallow the normal case', async () => {
        // Without this, an implementation that never commits anything passes
        // both tests above.
        const committed: string[] = [];
        const run = latestAnswerWins(
            async (v: string) => v,
            (v: string) => committed.push(v),
        );
        await run('only');
        expect(committed).toEqual(['only']);
    });

    test('a superseded call resolves rather than hanging', async () => {
        const { lookup, release } = deferrable();
        const run = latestAnswerWins(lookup, () => {});
        const first = run('a');
        const second = run('b');
        release(0);
        release(1);
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { concurrencyGate } from '../dist/index.js';

// Transactions hold a pooled connection each. Admitted without a bound, every
// connection can end up held by one waiting for a lock or for a connection a
// sibling needs; bounded below the pool, some stay free for the work that lets
// them finish.

/** Work that stays open until its `finish` is called, recording when it ran. */
function openWork(log, name) {
    let finish;
    const done = new Promise((resolve) => {
        finish = resolve;
    });
    return {
        run: async () => {
            log.push(`start ${name}`);
            await done;
            log.push(`end ${name}`);
            return name;
        },
        finish: () => finish(),
    };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// @requirement SC-COMP-018 — An installation bounds how many platform transactions hold a connection at once
describe('a concurrency gate', () => {
    test('admits no more than its limit at once, and the rest in arrival order', async () => {
        const admit = concurrencyGate(2);
        const log = [];
        const works = ['a', 'b', 'c', 'd'].map((name) => openWork(log, name));
        const results = works.map((work) => admit(work.run));
        await settle();
        assert.deepEqual(log, ['start a', 'start b'], 'two at once');

        works[1].finish();
        await settle();
        assert.deepEqual(log.slice(2), ['end b', 'start c'], 'the first in line goes next');

        works[0].finish();
        await settle();
        assert.deepEqual(log.slice(4), ['end a', 'start d']);

        works[2].finish();
        works[3].finish();
        assert.deepEqual(await Promise.all(results), ['a', 'b', 'c', 'd']);
    });

    test('gives the place back when the work fails', async () => {
        const admit = concurrencyGate(1);
        await assert.rejects(
            admit(async () => {
                throw new Error('lock timeout');
            }),
            /lock timeout/,
        );
        // Raced against the next turn of the event loop, so that a place never
        // given back fails the test instead of leaving it waiting forever.
        const next = admit(async () => 'admitted');
        assert.equal(await Promise.race([next, settle().then(() => 'still waiting')]), 'admitted');
    });

    for (const limit of [0, -1, 1.5, Number.NaN]) {
        test(`refuses a limit of ${limit}`, () => {
            assert.throws(() => concurrencyGate(limit), RangeError);
        });
    }
});

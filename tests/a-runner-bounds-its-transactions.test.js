import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PrismaTransactionRunner,
    prismaPersistence,
} from '../packages/adapter-prisma/dist/index.js';
import {
    DrizzleTransactionRunner,
    drizzlePersistence,
} from '../packages/adapter-drizzle/dist/index.js';

// Both runners take the same bound, and Prisma's hands its two limits over
// only where they were set. The clients stand in for the pool: each
// transaction stays open until the test lets it go.

function pool() {
    const calls = [];
    const open = [];
    let active = 0;
    let peak = 0;
    const transaction = (fn, options) => {
        calls.push(options);
        active += 1;
        peak = Math.max(peak, active);
        return new Promise((resolve) => {
            open.push(() => resolve(fn('tx')));
        }).finally(() => {
            active -= 1;
        });
    };
    return {
        calls,
        peak: () => peak,
        releaseAll: () => {
            while (open.length > 0) open.shift()();
        },
        prisma: { $transaction: transaction },
        drizzle: { transaction: (fn) => transaction(fn) },
    };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** The client's injection token, as an application passes its `PrismaService` class. */
const CLIENT = Symbol('client');

/** The bundle's runner as Nest builds it at boot, from the client the token resolves to. */
function resolvedAtBoot(bundle, client) {
    const provider = bundle.core.transactionRunner;
    assert.deepEqual(provider.inject, [CLIENT]);
    return provider.useFactory(client);
}

// @requirement SC-COMP-018 — An installation bounds how many platform transactions hold a connection at once
describe('the transaction runners', () => {
    for (const [name, build] of [
        ['PrismaTransactionRunner', (p, o) => new PrismaTransactionRunner(p.prisma, o)],
        ['DrizzleTransactionRunner', (p, o) => new DrizzleTransactionRunner(p.drizzle, o)],
        [
            'the runner of prismaPersistence',
            (p, o) =>
                resolvedAtBoot(prismaPersistence({ client: CLIENT, transactions: o }), p.prisma),
        ],
        [
            'the runner of drizzlePersistence',
            (p, o) =>
                resolvedAtBoot(drizzlePersistence({ db: CLIENT, transactions: o }), p.drizzle),
        ],
    ]) {
        test(`${name} holds at most maxConcurrent transactions open`, async () => {
            const p = pool();
            const runner = build(p, { maxConcurrent: 2 });
            const runs = Array.from({ length: 5 }, () => runner.run(async () => 'done'));
            for (let round = 0; round < 5; round += 1) {
                await settle();
                p.releaseAll();
            }
            assert.deepEqual(await Promise.all(runs), Array(5).fill('done'));
            assert.equal(p.peak(), 2);
        });

        test(`${name}: every runner on one pool shares its bound, a copy of the options too`, async () => {
            // Nest builds a runner for every module that asks for one; the
            // bound is the pool's, so they queue together.
            const p = pool();
            const first = build(p, { maxConcurrent: 2 });
            const second = build(p, { maxConcurrent: 2 });
            const runs = [first, second, first, second, first, second].map((runner) =>
                runner.run(async () => 'done'),
            );
            for (let round = 0; round < 6; round += 1) {
                await settle();
                p.releaseAll();
            }
            assert.deepEqual(await Promise.all(runs), Array(6).fill('done'));
            assert.equal(p.peak(), 2);
        });

        test(`${name}: two pools keep a bound each, whatever options object they share`, async () => {
            const options = { maxConcurrent: 2 };
            const one = pool();
            const other = pool();
            const runners = [build(one, options), build(other, options)];
            const runs = [0, 1, 0, 1, 0, 1].map((i) => runners[i].run(async () => 'done'));
            for (let round = 0; round < 6; round += 1) {
                await settle();
                one.releaseAll();
                other.releaseAll();
            }
            await Promise.all(runs);
            assert.equal(one.peak(), 2);
            assert.equal(other.peak(), 2);
        });

        test(`${name}: a second, different bound for one pool is refused`, () => {
            const p = pool();
            build(p, { maxConcurrent: 2 });
            assert.throws(() => build(p, { maxConcurrent: 3 }), RangeError);
        });

        test(`${name} without a bound opens as many as are asked for`, async () => {
            const p = pool();
            const runner = build(p, undefined);
            const runs = Array.from({ length: 5 }, () => runner.run(async () => 'done'));
            await settle();
            p.releaseAll();
            await Promise.all(runs);
            assert.equal(p.peak(), 5);
        });
    }

    test("Prisma's limits are handed over where they were set, and only those", async () => {
        const handedOver = async (options) => {
            const p = pool();
            const run = new PrismaTransactionRunner(p.prisma, options).run(async () => null);
            await settle();
            p.releaseAll();
            await run;
            return p.calls[0];
        };

        assert.deepEqual(await handedOver({ timeout: 30_000, maxWait: 10_000 }), {
            timeout: 30_000,
            maxWait: 10_000,
        });
        assert.deepEqual(await handedOver({ maxWait: 10_000 }), { maxWait: 10_000 });
        assert.equal(await handedOver(undefined), undefined, "Prisma's defaults stay in place");
    });
});

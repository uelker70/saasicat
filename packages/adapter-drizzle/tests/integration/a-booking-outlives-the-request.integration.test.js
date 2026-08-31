// What the bookings table remembers, and what "active" means when you ask it.
//
// The shared persistence contract books one bundle and reads it back, which
// proves the columns survive a round trip and nothing else. The rest of this
// repository — cancelling, reactivating, counting, and above all the predicate
// that decides whether a booking is active — is reached by nobody there.
//
// The predicate is the one worth the most care. It is expressed in SQL, where a
// comparison against NULL is neither true nor false, so a booking with no
// effective date can silently fall out of every "active" list without anything
// going red.
//
// Requires SAASICAT_TEST_DATABASE_URL pointing at a DISPOSABLE database.

// @requirement SC-OPS-001 — An operator can retry a failed deployment
// @requirement SC-BUN-027 — The same add-on cannot be booked twice on one subscription

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { DrizzleSubscriptionBundleRepository } from '../../dist/index.js';
import { openDisposableDatabase } from './support/disposable-database.mjs';

const at = (s) => new Date(`${s}T00:00:00.000Z`);

let pool;
let repository;
let subscriptionId;
let otherSubscriptionId;
let bundleVersionId;
let otherVersionId;

before(async () => {
    const opened = await openDisposableDatabase({ max: 4 });
    pool = opened.pool;
    repository = new DrizzleSubscriptionBundleRepository(opened.db);
});

after(async () => {
    await pool.end();
});

/** A published version to book, and a subscription to book it on. */
async function seedCatalogAndSubscription() {
    const planVersionId = randomUUID();
    await pool.query(
        `INSERT INTO plan_versions
           ("id","planId","version","features","quotas","monthlyNet","yearlyNet","marketed",
            "changeNote","nonRegressive","publishedAt","createdAt","updatedAt")
         VALUES ($1,'PRO',1,'[]','{}','49.00','490.00',true,'seed',true,NOW(),NOW(),NOW())`,
        [planVersionId],
    );
    const makeSubscription = async (tenantId) => {
        const id = randomUUID();
        await pool.query(
            `INSERT INTO subscriptions
               ("id","tenantId","plan","billingCycle","status","planVersionId","isPilot",
                "createdAt","updatedAt")
             VALUES ($1,$2,'PRO','MONTHLY','ACTIVE',$3,false,NOW(),NOW())`,
            [id, tenantId, planVersionId],
        );
        return id;
    };
    const bundleId = randomUUID();
    await pool.query(
        `INSERT INTO bundles
           ("id","bundleKey","label","sortOrder","i18n","createdAt","updatedAt")
         VALUES ($1,$2,'Reporting',0,'{}',NOW(),NOW())`,
        [bundleId, `REPORTING_${randomUUID().slice(0, 8)}`],
    );
    const makeVersion = async (version) => {
        const id = randomUUID();
        await pool.query(
            `INSERT INTO bundle_versions
               ("id","bundleId","version","features","quotas","compatibility","pricingOverrides",
                "marketed","changeNote","nonRegressive","publishedAt","createdAt","updatedAt")
             VALUES ($1,$2,$3,'[]','{}','{}','[]',true,'seed',true,NOW(),NOW(),NOW())`,
            [id, bundleId, version],
        );
        return id;
    };
    return {
        subscriptionId: await makeSubscription(`tenant-${randomUUID().slice(0, 8)}`),
        otherSubscriptionId: await makeSubscription(`tenant-${randomUUID().slice(0, 8)}`),
        bundleVersionId: await makeVersion(1),
        otherVersionId: await makeVersion(2),
    };
}

beforeEach(async () => {
    await pool.query(
        'TRUNCATE TABLE subscription_bundles, subscriptions, bundle_versions, bundles, ' +
            'plan_versions RESTART IDENTITY CASCADE',
    );
    ({ subscriptionId, otherSubscriptionId, bundleVersionId, otherVersionId } =
        await seedCatalogAndSubscription());
});

const book = (overrides = {}) =>
    repository.add({
        subscriptionId,
        bundleVersionId,
        startedAt: at('2026-01-01'),
        minimumTermEndsAt: null,
        ...overrides,
    });

describe('what a booking carries', () => {
    test('a booking with a window keeps every part of it', async () => {
        const booked = await book({
            billingCycle: 'MONTHLY',
            currentPeriodStart: at('2026-01-01'),
            currentPeriodEnd: at('2026-02-01'),
            minimumTermEndsAt: at('2027-01-01'),
        });

        const readBack = await repository.findById(booked.id);
        assert.equal(readBack.billingCycle, 'MONTHLY');
        assert.equal(readBack.currentPeriodEnd.toISOString(), '2026-02-01T00:00:00.000Z');
        assert.equal(readBack.minimumTermEndsAt.toISOString(), '2027-01-01T00:00:00.000Z');
        assert.equal(readBack.canceledAt, null);
    });

    test('a booking from before those columns keeps null, not an invented window', async () => {
        const booked = await book();
        const readBack = await repository.findById(booked.id);
        assert.equal(readBack.billingCycle, null);
        assert.equal(readBack.currentPeriodStart, null);
        assert.equal(readBack.currentPeriodEnd, null);
    });

    test('an id nobody booked answers null rather than throwing', async () => {
        assert.equal(await repository.findById(randomUUID()), null);
    });

    test('the list is the subscription’s own, not the neighbour’s', async () => {
        await book();
        await repository.add({
            subscriptionId: otherSubscriptionId,
            bundleVersionId,
            startedAt: at('2026-01-01'),
            minimumTermEndsAt: null,
        });

        const mine = await repository.listBySubscription(subscriptionId);
        assert.equal(mine.length, 1);
        assert.equal(mine[0].subscriptionId, subscriptionId);
    });

    test('a subscription with no bookings lists nothing, rather than everything', async () => {
        await book();
        assert.deepEqual(await repository.listBySubscription(otherSubscriptionId), []);
    });
});

describe('what counts as active', () => {
    // A cancellation declared for a future date leaves the booking running until
    // then; one whose date has passed does not. And a booking that was never
    // cancelled has NULL in both columns — the case a naive `canceledEffectiveAt
    // > now` drops silently, because NULL compares to nothing.

    test('a booking nobody cancelled is active', async () => {
        await book();
        const active = await repository.listActiveBySubscription(subscriptionId, at('2026-06-01'));
        assert.equal(active.length, 1);
    });

    test('a cancellation still ahead leaves it active', async () => {
        const booked = await book();
        await repository.cancel(booked.id, {
            canceledAt: at('2026-03-01'),
            canceledEffectiveAt: at('2026-09-01'),
        });

        const active = await repository.listActiveBySubscription(subscriptionId, at('2026-06-01'));
        assert.equal(active.length, 1, 'a declared cancellation does not end anything');
    });

    test('a cancellation that has landed ends it', async () => {
        const booked = await book();
        await repository.cancel(booked.id, {
            canceledAt: at('2026-03-01'),
            canceledEffectiveAt: at('2026-04-01'),
        });

        assert.deepEqual(
            await repository.listActiveBySubscription(subscriptionId, at('2026-06-01')),
            [],
        );
    });

    test('the effective date itself is the first moment it is over', async () => {
        const booked = await book();
        await repository.cancel(booked.id, {
            canceledAt: at('2026-03-01'),
            canceledEffectiveAt: at('2026-04-01'),
        });

        const justBefore = new Date('2026-03-31T23:59:59.999Z');
        assert.equal(
            (await repository.listActiveBySubscription(subscriptionId, justBefore)).length,
            1,
        );
        assert.deepEqual(
            await repository.listActiveBySubscription(subscriptionId, at('2026-04-01')),
            [],
        );
    });

    test('asking without a moment asks about now', async () => {
        await book();
        assert.equal((await repository.listActiveBySubscription(subscriptionId)).length, 1);
    });
});

describe('undoing a cancellation', () => {
    test('reactivating clears both dates and the booking is active again', async () => {
        const booked = await book();
        await repository.cancel(booked.id, {
            canceledAt: at('2026-03-01'),
            canceledEffectiveAt: at('2026-04-01'),
        });

        const back = await repository.reactivate(booked.id);
        assert.equal(back.canceledAt, null);
        assert.equal(back.canceledEffectiveAt, null);
        assert.equal(
            (await repository.listActiveBySubscription(subscriptionId, at('2026-06-01'))).length,
            1,
        );
    });

    test('cancelling something that is not there says so, rather than doing nothing quietly', async () => {
        await assert.rejects(
            () =>
                repository.cancel(randomUUID(), {
                    canceledAt: at('2026-03-01'),
                    canceledEffectiveAt: at('2026-04-01'),
                }),
            /not found/,
        );
    });

    test('reactivating something that is not there says so too', async () => {
        await assert.rejects(() => repository.reactivate(randomUUID()), /not found/);
    });
});

describe('counting what a catalogue version still owes', () => {
    // The number an operator sees before retiring a version: how many tenants
    // would lose something.

    test('active bookings of that version are counted, across subscriptions', async () => {
        await book();
        await repository.add({
            subscriptionId: otherSubscriptionId,
            bundleVersionId,
            startedAt: at('2026-01-01'),
            minimumTermEndsAt: null,
        });

        assert.equal(
            await repository.countActiveByBundleVersionId(bundleVersionId, at('2026-06-01')),
            2,
        );
    });

    test('a different version is not counted', async () => {
        await book();
        assert.equal(
            await repository.countActiveByBundleVersionId(otherVersionId, at('2026-06-01')),
            0,
        );
    });

    test('a booking whose cancellation has landed is not counted', async () => {
        const booked = await book();
        await repository.cancel(booked.id, {
            canceledAt: at('2026-03-01'),
            canceledEffectiveAt: at('2026-04-01'),
        });

        assert.equal(
            await repository.countActiveByBundleVersionId(bundleVersionId, at('2026-06-01')),
            0,
        );
    });

    test('a version nobody booked counts zero', async () => {
        assert.equal(await repository.countActiveByBundleVersionId(randomUUID()), 0);
    });
});

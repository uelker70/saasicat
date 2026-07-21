import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// FakeSubscriptionBundleRepository — in-memory adapter for the
// `subscription_bundles` junction (SPEC_V2 §11.1 M6 Pack 2e). The tests
// cover the repo API: add → listBy → cancel → countActive. The
// business layer (minimum-term default, plan-compat check on
// add) belongs in a service and is tested separately once it
// exists (see OPEN_ISSUES P11.7.3 remaining work).

const SUB_A = 'sub-a';
const SUB_B = 'sub-b';
const BV_A = 'bv-a';
const BV_B = 'bv-b';

let repo;

beforeEach(() => {
    repo = new FakeSubscriptionBundleRepository();
});

describe('SubscriptionBundleRepository — lifecycle', () => {
    test('add + listBySubscription returns the new booking', async () => {
        const startedAt = new Date('2026-01-01T00:00:00Z');
        const row = await repo.add({
            subscriptionId: SUB_A,
            bundleVersionId: BV_A,
            startedAt,
        });
        assert.equal(row.subscriptionId, SUB_A);
        assert.equal(row.bundleVersionId, BV_A);
        assert.equal(row.canceledAt, null);
        assert.equal(row.minimumTermEndsAt, null);

        const list = await repo.listBySubscription(SUB_A);
        assert.equal(list.length, 1);
        assert.equal(list[0].id, row.id);
    });

    test('listActiveBySubscription filters canceled bookings with a past effective date', async () => {
        const startedAt = new Date('2026-01-01T00:00:00Z');
        const cancelEffective = new Date('2026-02-01T00:00:00Z');

        const active = await repo.add({ subscriptionId: SUB_A, bundleVersionId: BV_A, startedAt });
        const canceled = await repo.add({
            subscriptionId: SUB_A,
            bundleVersionId: BV_B,
            startedAt,
        });
        await repo.cancel(canceled.id, {
            canceledAt: new Date('2026-01-15T00:00:00Z'),
            canceledEffectiveAt: cancelEffective,
        });

        // asOf = 2026-03-01 → cancelEffective is in the past
        const list = await repo.listActiveBySubscription(SUB_A, new Date('2026-03-01T00:00:00Z'));
        assert.equal(list.length, 1);
        assert.equal(list[0].id, active.id);

        // asOf = 2026-01-20 → cancelEffective is in the future → still active
        const list2 = await repo.listActiveBySubscription(SUB_A, new Date('2026-01-20T00:00:00Z'));
        assert.equal(list2.length, 2);
    });

    test('cancel: second call throws', async () => {
        const row = await repo.add({
            subscriptionId: SUB_A,
            bundleVersionId: BV_A,
            startedAt: new Date('2026-01-01T00:00:00Z'),
        });
        await repo.cancel(row.id, {
            canceledAt: new Date('2026-01-15T00:00:00Z'),
            canceledEffectiveAt: new Date('2026-02-01T00:00:00Z'),
        });
        await assert.rejects(() =>
            repo.cancel(row.id, {
                canceledAt: new Date(),
                canceledEffectiveAt: new Date(),
            }),
        );
    });

    test('countActiveByBundleVersionId counts only non-canceled (or future-effective) bookings', async () => {
        const startedAt = new Date('2026-01-01T00:00:00Z');
        const a = await repo.add({ subscriptionId: SUB_A, bundleVersionId: BV_A, startedAt });
        await repo.add({ subscriptionId: SUB_B, bundleVersionId: BV_A, startedAt });
        const c = await repo.add({ subscriptionId: SUB_A, bundleVersionId: BV_B, startedAt });
        await repo.cancel(a.id, {
            canceledAt: new Date('2026-01-10T00:00:00Z'),
            canceledEffectiveAt: new Date('2026-01-15T00:00:00Z'),
        });

        // asOf = 2026-02-01 → a is effectively canceled; b active
        const ab = await repo.countActiveByBundleVersionId(BV_A, new Date('2026-02-01T00:00:00Z'));
        assert.equal(ab, 1);
        const bc = await repo.countActiveByBundleVersionId(BV_B, new Date('2026-02-01T00:00:00Z'));
        assert.equal(bc, 1);

        // asOf = 2026-01-12 → a's cancellation not yet effective
        const abEarly = await repo.countActiveByBundleVersionId(
            BV_A,
            new Date('2026-01-12T00:00:00Z'),
        );
        assert.equal(abEarly, 2);

        // c stays active (never canceled)
        void c;
    });
});

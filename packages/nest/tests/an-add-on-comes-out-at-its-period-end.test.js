import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlesService } from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// When a tenant gets out of an add-on again.
//
// The rule: cancellable at any time up to the moment the next period begins,
// effective at the end of the period it is in. The premise behind it is that no
// money is ever paid back — the tenant pays for the period they are in, it ends
// normally, and no refund arises.
//
// The dates below are the reported case: a yearly Starter plan billed on the
// 23rd with its next billing date on 2027-07-23, and an add-on booked on
// 2026-08-27. Before this was fixed the dialog offered a twelve-month
// commitment nobody had asked for — until 2027-08-27, which for a yearly add-on
// is 35 days *after* the bundle's own last period ends.

const STARTER = 'STARTER';
const SUB = 'sub-a';

const BOOKED_AT = new Date('2026-08-27T00:00:00Z');
const PLAN_PERIOD_END = new Date('2027-07-23T00:00:00Z');
const PLAN_ANCHOR_DAY = 23;

let bundleRepo;
let subBundleRepo;
let service;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    subBundleRepo = new FakeSubscriptionBundleRepository();
    service = new SubscriptionBundlesService(subBundleRepo, bundleRepo);
});

async function publishedBundle(key) {
    const bundle = await bundleRepo.create({ bundleKey: key, label: key });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features: ['F'],
        monthlyNet: '9.90',
        yearlyNet: '99.00',
    });
    return bundleRepo.publishDraft(draft.id, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validUntil: null,
    });
}

const book = async (key, billingCycle) => {
    const bv = await publishedBundle(key);
    return service.addBundleToSubscription({
        subscriptionId: SUB,
        bundleVersionId: bv.id,
        currentPlanKey: STARTER,
        startedAt: BOOKED_AT,
        parentEndsAt: null,
        planCycle: 'YEARLY',
        planPeriodEnd: PLAN_PERIOD_END,
        planAnchorDay: PLAN_ANCHOR_DAY,
        billingCycle,
    });
};

const iso = (d) => d?.toISOString().slice(0, 10) ?? null;

// @requirement SC-BUN-009 — An add-on can be cancelled at any time and ends with the period it is in
// @requirement SC-BUN-010 — The period an add-on ends at is its own, not the plan's
describe('a monthly add-on beside a yearly plan', () => {
    test('commits to nothing and runs to the plan’s billing day', async () => {
        const row = await book('MONTHLY_ADDON', 'MONTHLY');
        assert.equal(row.minimumTermEndsAt, null, 'nobody asked for a commitment');
        assert.equal(
            iso(row.currentPeriodEnd),
            '2026-09-23',
            'the plan’s billing day, not the 27th',
        );
    });

    test('cancelling lands at the end of the period it is in', async () => {
        const row = await book('MONTHLY_CANCEL', 'MONTHLY');
        const cancelled = await service.cancelBundleFromSubscription({
            subscriptionBundleId: row.id,
            canceledAt: new Date('2026-09-01T00:00:00Z'),
            parentEndsAt: null,
        });
        assert.equal(iso(cancelled.canceledEffectiveAt), '2026-09-23');
    });

    test('cancelling on the last day of the period still lands on that day', async () => {
        // "Up to 0 days before the next period begins" — the boundary itself,
        // which is where an off-by-one would push the tenant into another month
        // they would then have to be refunded for.
        const row = await book('MONTHLY_EDGE', 'MONTHLY');
        const cancelled = await service.cancelBundleFromSubscription({
            subscriptionBundleId: row.id,
            canceledAt: new Date('2026-09-23T00:00:00Z'),
            parentEndsAt: null,
        });
        assert.equal(iso(cancelled.canceledEffectiveAt), '2026-09-23');
    });
});

// @requirement SC-BUN-009 — An add-on can be cancelled at any time and ends with the period it is in
describe('a yearly add-on beside a yearly plan', () => {
    test('commits to nothing and ends with the plan period that pays for it', async () => {
        const row = await book('YEARLY_ADDON', 'YEARLY');
        assert.equal(row.minimumTermEndsAt, null);
        assert.equal(
            iso(row.currentPeriodEnd),
            '2027-07-23',
            'a bundle may not outlast the plan period it hangs on',
        );
    });

    test('cancelling lands at that same end, not a year after the booking', async () => {
        // The reported defect in one line: the old default put this at
        // 2027-08-27, after the bundle's own last period.
        const row = await book('YEARLY_CANCEL', 'YEARLY');
        const cancelled = await service.cancelBundleFromSubscription({
            subscriptionBundleId: row.id,
            canceledAt: new Date('2026-09-01T00:00:00Z'),
            parentEndsAt: null,
        });
        assert.equal(iso(cancelled.canceledEffectiveAt), '2027-07-23');
    });
});

// @requirement SC-BUN-008 — An add-on carries no commitment unless an operator configures one
// @requirement SC-BUN-012 — An add-on can never be committed past the subscription that pays for it
describe('a commitment an operator did configure', () => {
    test('binds inside it, and still cannot outlast the plan', async () => {
        const withTerm = new SubscriptionBundlesService(subBundleRepo, bundleRepo, {
            defaultMinimumTermMonths: 12,
        });
        const bv = await publishedBundle('COMMITTED');
        const row = await withTerm.addBundleToSubscription({
            subscriptionId: SUB,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
            startedAt: BOOKED_AT,
            // The plan ends: the commitment is capped there rather than
            // binding the tenant past what they can use.
            parentEndsAt: PLAN_PERIOD_END,
            planCycle: 'YEARLY',
            planPeriodEnd: PLAN_PERIOD_END,
            planAnchorDay: PLAN_ANCHOR_DAY,
            billingCycle: 'MONTHLY',
        });
        assert.equal(iso(row.minimumTermEndsAt), '2027-07-23', 'capped at the parent’s end');

        const cancelled = await withTerm.cancelBundleFromSubscription({
            subscriptionBundleId: row.id,
            canceledAt: new Date('2026-09-01T00:00:00Z'),
            parentEndsAt: PLAN_PERIOD_END,
        });
        assert.equal(
            iso(cancelled.canceledEffectiveAt),
            '2027-07-23',
            'a configured commitment does bind — that is what configuring it means',
        );
    });
});

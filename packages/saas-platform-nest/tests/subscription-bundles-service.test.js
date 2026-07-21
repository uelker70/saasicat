import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlesService } from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// SubscriptionBundlesService — service tests against the in-memory adapters
// (FakeBundleRepository + FakeSubscriptionBundleRepository). Covers:
// plan compatibility check, minimum-term default, idempotency, effective-date
// computation.

const PROJECT = 'clubapp';
const STARTER = 'STARTER';
const PRO = 'PRO';
const SUB_A = 'sub-a';

let bundleRepo;
let subBundleRepo;
let service;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    subBundleRepo = new FakeSubscriptionBundleRepository();
    service = new SubscriptionBundlesService(subBundleRepo, bundleRepo);
});

async function createPublishedBundle({ key, planIds, features = ['F'] } = {}) {
    const bundle = await bundleRepo.create({
        projectKey: PROJECT,
        bundleKey: key,
        label: key,
    });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features,
        compatibility: planIds ? { planIds } : {},
    });
    const published = await bundleRepo.publishDraft(draft.id, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validUntil: null,
    });
    return published;
}

describe('SubscriptionBundlesService — addBundleToSubscription', () => {
    test('creates the booking + sets the minimum term to the +12 months default', async () => {
        const bv = await createPublishedBundle({ key: 'B1', planIds: [STARTER] });
        const startedAt = new Date('2026-03-15T00:00:00Z');
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
            startedAt,
        });
        assert.equal(row.subscriptionId, SUB_A);
        assert.equal(row.bundleVersionId, bv.id);
        assert.equal(row.canceledAt, null);
        // 12 months later (UTC), day 15 is preserved
        assert.equal(row.minimumTermEndsAt?.toISOString(), '2027-03-15T00:00:00.000Z');
    });

    test('minimumTermMonths=0 → null (no minimum term)', async () => {
        const bv = await createPublishedBundle({ key: 'B1', planIds: [STARTER] });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
            startedAt: new Date('2026-01-01T00:00:00Z'),
            minimumTermMonths: 0,
        });
        assert.equal(row.minimumTermEndsAt, null);
    });

    test('plan compatibility check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN on the wrong plan', async () => {
        const bv = await createPublishedBundle({ key: 'B1', planIds: [PRO] });
        await assert.rejects(
            () =>
                service.addBundleToSubscription({
                    subscriptionId: SUB_A,
                    bundleVersionId: bv.id,
                    currentPlanKey: STARTER,
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_INCOMPATIBLE_WITH_PLAN');
                return true;
            },
        );
    });

    test('plan compatibility: empty planIds array = all plans allowed', async () => {
        const bv = await createPublishedBundle({ key: 'B1' });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: 'IRGENDWAS',
        });
        assert.equal(row.bundleVersionId, bv.id);
    });

    test('idempotency: second booking of the same bundle version → 422 BUNDLE_ALREADY_SUBSCRIBED', async () => {
        const bv = await createPublishedBundle({ key: 'B1', planIds: [STARTER] });
        await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
        });
        await assert.rejects(
            () =>
                service.addBundleToSubscription({
                    subscriptionId: SUB_A,
                    bundleVersionId: bv.id,
                    currentPlanKey: STARTER,
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_ALREADY_SUBSCRIBED');
                return true;
            },
        );
    });

    test('draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED', async () => {
        const bundle = await bundleRepo.create({
            projectKey: PROJECT,
            bundleKey: 'B1',
            label: 'X',
        });
        const draft = await bundleRepo.createDraft({ bundleId: bundle.id, features: ['F'] });
        await assert.rejects(
            () =>
                service.addBundleToSubscription({
                    subscriptionId: SUB_A,
                    bundleVersionId: draft.id,
                    currentPlanKey: STARTER,
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_VERSION_NOT_PUBLISHED');
                return true;
            },
        );
    });

    test('custom defaultMinimumTermMonths from the config token takes effect', async () => {
        const svc = new SubscriptionBundlesService(subBundleRepo, bundleRepo, {
            defaultMinimumTermMonths: 24,
        });
        const bv = await createPublishedBundle({ key: 'B1', planIds: [STARTER] });
        const row = await svc.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
            startedAt: new Date('2026-03-15T00:00:00Z'),
        });
        assert.equal(row.minimumTermEndsAt?.toISOString(), '2028-03-15T00:00:00.000Z');
    });
});

describe('SubscriptionBundlesService — cancelBundleFromSubscription', () => {
    test('canceledEffectiveAt = currentPeriodEnd when the minimum term has already elapsed', async () => {
        const bv = await createPublishedBundle({ key: 'B1', planIds: [STARTER] });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
            startedAt: new Date('2025-01-01T00:00:00Z'),
            minimumTermMonths: 6,
        });
        // Minimum term ended on 2025-07-01; now cancel with periodEnd 2026-04-30
        const periodEnd = new Date('2026-04-30T00:00:00Z');
        const canceled = await service.cancelBundleFromSubscription({
            subscriptionBundleId: row.id,
            canceledAt: new Date('2026-04-10T00:00:00Z'),
            currentPeriodEnd: periodEnd,
        });
        assert.equal(canceled.canceledEffectiveAt?.toISOString(), periodEnd.toISOString());
    });

    test('canceledEffectiveAt = minimumTermEndsAt when the minimum term is longer than the period', async () => {
        const bv = await createPublishedBundle({ key: 'B1', planIds: [STARTER] });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
            startedAt: new Date('2026-01-01T00:00:00Z'),
            minimumTermMonths: 12, // → 2027-01-01
        });
        const periodEnd = new Date('2026-04-30T00:00:00Z');
        const canceled = await service.cancelBundleFromSubscription({
            subscriptionBundleId: row.id,
            canceledAt: new Date('2026-04-10T00:00:00Z'),
            currentPeriodEnd: periodEnd,
        });
        assert.equal(canceled.canceledEffectiveAt?.toISOString(), '2027-01-01T00:00:00.000Z');
    });

    test('second cancellation → 422 SUBSCRIPTION_BUNDLE_ALREADY_CANCELED', async () => {
        const bv = await createPublishedBundle({ key: 'B1', planIds: [STARTER] });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
        });
        await service.cancelBundleFromSubscription({
            subscriptionBundleId: row.id,
            canceledAt: new Date(),
            currentPeriodEnd: new Date('2099-01-01'),
        });
        await assert.rejects(
            () =>
                service.cancelBundleFromSubscription({
                    subscriptionBundleId: row.id,
                    canceledAt: new Date(),
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELED');
                return true;
            },
        );
    });

    test('unknown ID → 404', async () => {
        await assert.rejects(
            () =>
                service.cancelBundleFromSubscription({
                    subscriptionBundleId: 'does-not-exist',
                    canceledAt: new Date(),
                }),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });
});

describe('SubscriptionBundlesService — Self-Service-Policy (#37)', () => {
    test('sales-only bundle throws 422 BUNDLE_NOT_SELF_SERVICE', async () => {
        const bv = await createPublishedBundle({ key: 'ENTERPRISE_PACK' });
        const blocked = new SubscriptionBundlesService(
            subBundleRepo,
            bundleRepo,
            {},
            { bundleKeys: ['ENTERPRISE_PACK'] },
        );
        await assert.rejects(
            () =>
                blocked.addBundleToSubscription({
                    subscriptionId: SUB_A,
                    bundleVersionId: bv.id,
                    currentPlanKey: STARTER,
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'BUNDLE_NOT_SELF_SERVICE');
                return true;
            },
        );
    });

    test('without a policy the bundle stays bookable', async () => {
        const bv = await createPublishedBundle({ key: 'ENTERPRISE_PACK' });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
        });
        assert.equal(row.canceledAt, null);
    });
});

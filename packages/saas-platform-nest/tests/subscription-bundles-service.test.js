import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlesService } from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// SubscriptionBundlesService — Service-Tests gegen die In-Memory-Adapter
// (FakeBundleRepository + FakeSubscriptionBundleRepository). Deckt:
// Plan-Kompat-Check, Mindestlaufzeit-Default, Idempotenz, Effektiv-Datum-
// Rechnung.

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
    test('legt Buchung an + setzt Mindestlaufzeit auf +12 Monate Default', async () => {
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
        // 12 Monate später (UTC), Tag 15 bleibt erhalten
        assert.equal(row.minimumTermEndsAt?.toISOString(), '2027-03-15T00:00:00.000Z');
    });

    test('minimumTermMonths=0 → null (keine Mindestlaufzeit)', async () => {
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

    test('Plan-Kompat-Check: 422 BUNDLE_INCOMPATIBLE_WITH_PLAN bei falschem Plan', async () => {
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

    test('Plan-Kompat: leeres planIds-Array = alle Pläne erlaubt', async () => {
        const bv = await createPublishedBundle({ key: 'B1' });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: 'IRGENDWAS',
        });
        assert.equal(row.bundleVersionId, bv.id);
    });

    test('Idempotenz: zweite Buchung derselben BundleVersion → 422 BUNDLE_ALREADY_SUBSCRIBED', async () => {
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

    test('Draft (publishedAt=null) → 422 BUNDLE_VERSION_NOT_PUBLISHED', async () => {
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

    test('Custom defaultMinimumTermMonths aus Config-Token wirkt', async () => {
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
    test('canceledEffectiveAt = currentPeriodEnd, wenn Mindestlaufzeit schon abgelaufen', async () => {
        const bv = await createPublishedBundle({ key: 'B1', planIds: [STARTER] });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
            startedAt: new Date('2025-01-01T00:00:00Z'),
            minimumTermMonths: 6,
        });
        // Min-Term endete am 2025-07-01; jetzt kündigen mit periodEnd 2026-04-30
        const periodEnd = new Date('2026-04-30T00:00:00Z');
        const canceled = await service.cancelBundleFromSubscription({
            subscriptionBundleId: row.id,
            canceledAt: new Date('2026-04-10T00:00:00Z'),
            currentPeriodEnd: periodEnd,
        });
        assert.equal(canceled.canceledEffectiveAt?.toISOString(), periodEnd.toISOString());
    });

    test('canceledEffectiveAt = minimumTermEndsAt, wenn Mindestlaufzeit länger als Periode', async () => {
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

    test('zweite Kündigung → 422 SUBSCRIPTION_BUNDLE_ALREADY_CANCELED', async () => {
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

    test('unbekannte ID → 404', async () => {
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
    test('Vertriebs-only-Bundle wirft 422 BUNDLE_NOT_SELF_SERVICE', async () => {
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

    test('ohne Policy bleibt das Bundle buchbar', async () => {
        const bv = await createPublishedBundle({ key: 'ENTERPRISE_PACK' });
        const row = await service.addBundleToSubscription({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            currentPlanKey: STARTER,
        });
        assert.equal(row.canceledAt, null);
    });
});

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlePreviewService } from '../dist/billing/index.js';
import {
    FakeBundleRepository,
    FakePlanRepository,
    FakeSubscriptionBundleRepository,
} from '../dist/testing/index.js';

// SubscriptionBundlePreviewService (#37) — add/cancel preview with
// proration (shared computeProration helper), redundancy hint
// (sakarel AK-13), requires dependency check (#35) and self-service policy.

const PROJECT = 'clubapp';
const SUB_A = 'sub-a';
const NOW = new Date('2026-05-17T00:00:00Z');

// May 2026: 31 period days, from 05-17 there are 15 days remaining.
const CTX = {
    subscriptionId: SUB_A,
    currentPlanKey: 'PRO',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
};

let bundleRepo;
let subBundleRepo;
let planRepo;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    subBundleRepo = new FakeSubscriptionBundleRepository();
    planRepo = new FakePlanRepository();
    planRepo.seedVersion({
        id: 'pv-pro-1',
        planId: 'PRO',
        version: 1,
        baseVersionId: null,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        publishedChanges: [],
        changeNote: 'init',
        nonRegressive: true,
        validFrom: null,
        validUntil: null,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        features: ['CORE', 'WHATSAPP'],
        quotas: { users: 10 },
        monthlyNet: '49.00',
        yearlyNet: '490.00',
        marketed: true,
    });
});

function buildService({ catalogEntryRepo = null, blockedBundles = null, plans = planRepo } = {}) {
    return new SubscriptionBundlePreviewService(
        subBundleRepo,
        bundleRepo,
        plans,
        catalogEntryRepo,
        blockedBundles,
    );
}

function catalogEntryRepoWith(requiresByFeature) {
    return {
        listFeatures: async () =>
            Object.entries(requiresByFeature).map(([featureKey, requires]) => ({
                featureKey,
                requires,
            })),
    };
}

async function createPublishedBundle({
    key,
    features = ['F'],
    monthlyNet = '31.00',
    yearlyNet = '310.00',
    pricingOverrides = [],
    planIds,
} = {}) {
    const bundle = await bundleRepo.create({ projectKey: PROJECT, bundleKey: key, label: key });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features,
        monthlyNet,
        yearlyNet,
        pricingOverrides,
        compatibility: planIds ? { planIds } : {},
    });
    return bundleRepo.publishDraft(draft.id, {
        publishedByUserId: null,
        publishedChanges: [],
        nonRegressive: true,
        validFrom: new Date('2026-01-01T00:00:00Z'),
        validUntil: null,
    });
}

describe('SubscriptionBundlePreviewService — previewAdd', () => {
    test('proration: prorated amount until period end + next-period price', async () => {
        const bv = await createPublishedBundle({ key: 'B1', monthlyNet: '31.00' });
        const dto = await buildService().previewAdd(CTX, { bundleVersionId: bv.id }, NOW);

        assert.equal(dto.action, 'add');
        assert.equal(dto.nextPeriodPriceNet, 31);
        assert.equal(dto.proration.daysInPeriod, 31);
        assert.equal(dto.proration.daysRemainingInPeriod, 15);
        assert.equal(dto.proration.currentPriceNet, 0);
        assert.equal(dto.proration.targetPriceNet, 31);
        assert.equal(dto.proration.prorataDeltaNet, 15);
        assert.deepEqual(dto.blockers, []);
    });

    test('YEARLY cycle uses yearlyNet, plan-specific pricing override wins', async () => {
        const bv = await createPublishedBundle({
            key: 'B1',
            yearlyNet: '310.00',
            pricingOverrides: [{ planId: 'PRO', yearlyNet: '250.00' }],
        });
        const dto = await buildService().previewAdd(
            { ...CTX, billingCycle: 'YEARLY' },
            { bundleVersionId: bv.id },
            NOW,
        );
        assert.equal(dto.nextPeriodPriceNet, 250);
        assert.equal(dto.proration.targetPriceNet, 250);
    });

    test('TRIAL: no proration (no paid period yet)', async () => {
        const bv = await createPublishedBundle({ key: 'B1' });
        const dto = await buildService().previewAdd(
            { ...CTX, status: 'TRIAL' },
            { bundleVersionId: bv.id },
            NOW,
        );
        assert.equal(dto.proration, null);
        assert.equal(dto.nextPeriodPriceNet, 31);
    });

    test('minimum term: default 12 months from now, 0 = none', async () => {
        const bv = await createPublishedBundle({ key: 'B1' });
        const svc = buildService();

        const dto = await svc.previewAdd(CTX, { bundleVersionId: bv.id }, NOW);
        assert.equal(dto.minimumTermMonths, 12);
        assert.equal(dto.minimumTermEndsAt.toISOString(), '2027-05-17T00:00:00.000Z');

        const none = await svc.previewAdd(
            CTX,
            { bundleVersionId: bv.id, minimumTermMonths: 0 },
            NOW,
        );
        assert.equal(none.minimumTermEndsAt, null);
    });

    test('redundancy (AK-13): feature already in plan → hint + warning', async () => {
        const bv = await createPublishedBundle({ key: 'B1', features: ['WHATSAPP', 'NEU'] });
        const dto = await buildService().previewAdd(CTX, { bundleVersionId: bv.id }, NOW);

        assert.deepEqual(dto.redundantFeatures, [
            { featureKey: 'WHATSAPP', coveredBy: 'PLAN', coveredByKey: 'PRO' },
        ]);
        assert.ok(dto.warnings.some((w) => w.code === 'REDUNDANT_FEATURES'));
    });

    test('redundancy: feature already in another active bundle → hint with bundleKey', async () => {
        const existing = await createPublishedBundle({ key: 'ALT', features: ['CAMPAIGNS'] });
        await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: existing.id,
            startedAt: new Date('2026-02-01T00:00:00Z'),
            minimumTermEndsAt: null,
        });
        const bv = await createPublishedBundle({ key: 'NEU', features: ['CAMPAIGNS'] });

        const dto = await buildService().previewAdd(CTX, { bundleVersionId: bv.id }, NOW);
        assert.deepEqual(dto.redundantFeatures, [
            { featureKey: 'CAMPAIGNS', coveredBy: 'BUNDLE', coveredByKey: 'ALT' },
        ]);
    });

    test('requires (#35): uncovered dependency → missingRequires + blocker', async () => {
        const bv = await createPublishedBundle({
            key: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
        });
        const dto = await buildService({
            catalogEntryRepo: catalogEntryRepoWith({
                TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'],
            }),
        }).previewAdd(CTX, { bundleVersionId: bv.id }, NOW);

        assert.deepEqual(dto.missingRequires, ['RESOURCE_MANAGEMENT']);
        assert.ok(dto.blockers.some((b) => b.code === 'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED'));
    });

    test('requires: coverage by plan or active bundle → no blocker', async () => {
        const planCovered = await createPublishedBundle({ key: 'P', features: ['X'] });
        const svc = buildService({
            catalogEntryRepo: catalogEntryRepoWith({ X: ['WHATSAPP'] }),
        });
        const viaPlan = await svc.previewAdd(CTX, { bundleVersionId: planCovered.id }, NOW);
        assert.deepEqual(viaPlan.missingRequires, []);

        const ressourcen = await createPublishedBundle({
            key: 'RESSOURCEN',
            features: ['RESOURCE_MANAGEMENT'],
        });
        await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: ressourcen.id,
            startedAt: new Date('2026-02-01T00:00:00Z'),
            minimumTermEndsAt: null,
        });
        const turniere = await createPublishedBundle({
            key: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
        });
        const viaBundle = await buildService({
            catalogEntryRepo: catalogEntryRepoWith({
                TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'],
            }),
        }).previewAdd(CTX, { bundleVersionId: turniere.id }, NOW);
        assert.deepEqual(viaBundle.missingRequires, []);
    });

    test('requires: without CatalogEntryRepository no check (graceful)', async () => {
        const bv = await createPublishedBundle({
            key: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
        });
        const dto = await buildService().previewAdd(CTX, { bundleVersionId: bv.id }, NOW);
        assert.deepEqual(dto.missingRequires, []);
    });

    test('self-service policy: sales-only bundle → blocker BUNDLE_NOT_SELF_SERVICE', async () => {
        const bv = await createPublishedBundle({ key: 'ENTERPRISE_PACK' });
        const dto = await buildService({
            blockedBundles: { bundleKeys: ['ENTERPRISE_PACK'] },
        }).previewAdd(CTX, { bundleVersionId: bv.id }, NOW);
        assert.ok(dto.blockers.some((b) => b.code === 'BUNDLE_NOT_SELF_SERVICE'));
    });

    test('blocker: plan-incompatible + already booked', async () => {
        const incompatible = await createPublishedBundle({ key: 'B1', planIds: ['STARTER'] });
        const svc = buildService();
        const dto = await svc.previewAdd(CTX, { bundleVersionId: incompatible.id }, NOW);
        assert.ok(dto.blockers.some((b) => b.code === 'BUNDLE_INCOMPATIBLE_WITH_PLAN'));

        const booked = await createPublishedBundle({ key: 'B2' });
        await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: booked.id,
            startedAt: new Date('2026-02-01T00:00:00Z'),
            minimumTermEndsAt: null,
        });
        const again = await svc.previewAdd(CTX, { bundleVersionId: booked.id }, NOW);
        assert.ok(again.blockers.some((b) => b.code === 'BUNDLE_ALREADY_SUBSCRIBED'));
    });

    test('unknown bundle version → NotFound', async () => {
        await assert.rejects(
            () => buildService().previewAdd(CTX, { bundleVersionId: 'nope' }, NOW),
            /nicht gefunden/,
        );
    });
});

describe('SubscriptionBundlePreviewService — previewCancel', () => {
    test('effectiveAt = period end when minimum term expired', async () => {
        const bv = await createPublishedBundle({ key: 'B1', monthlyNet: '31.00' });
        const booking = await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            startedAt: new Date('2025-01-01T00:00:00Z'),
            minimumTermEndsAt: new Date('2026-01-01T00:00:00Z'),
        });

        const dto = await buildService().previewCancel(
            CTX,
            { subscriptionBundleId: booking.id },
            NOW,
        );
        assert.equal(dto.action, 'cancel');
        assert.equal(dto.effectiveAt.toISOString(), '2026-06-01T00:00:00.000Z');
        assert.equal(dto.nextPeriodSavingsNet, 31);
        assert.deepEqual(dto.blockers, []);
        assert.deepEqual(dto.warnings, []);
    });

    test('minimum term binds beyond period end → effectiveAt + warning', async () => {
        const bv = await createPublishedBundle({ key: 'B1' });
        const booking = await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            startedAt: new Date('2026-03-01T00:00:00Z'),
            minimumTermEndsAt: new Date('2027-03-01T00:00:00Z'),
        });

        const dto = await buildService().previewCancel(
            CTX,
            { subscriptionBundleId: booking.id },
            NOW,
        );
        assert.equal(dto.effectiveAt.toISOString(), '2027-03-01T00:00:00.000Z');
        assert.ok(dto.warnings.some((w) => w.code === 'MINIMUM_TERM_BINDS'));
    });

    test('already canceled → blocker', async () => {
        const bv = await createPublishedBundle({ key: 'B1' });
        const booking = await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            startedAt: new Date('2026-01-01T00:00:00Z'),
            minimumTermEndsAt: null,
        });
        await subBundleRepo.cancel(booking.id, {
            canceledAt: NOW,
            canceledEffectiveAt: CTX.currentPeriodEnd,
        });

        const dto = await buildService().previewCancel(
            CTX,
            { subscriptionBundleId: booking.id },
            NOW,
        );
        assert.ok(dto.blockers.some((b) => b.code === 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELED'));
    });

    test('foreign subscription → NotFound (no cross-tenant leak)', async () => {
        const bv = await createPublishedBundle({ key: 'B1' });
        const booking = await subBundleRepo.add({
            subscriptionId: 'sub-other',
            bundleVersionId: bv.id,
            startedAt: new Date('2026-01-01T00:00:00Z'),
            minimumTermEndsAt: null,
        });
        await assert.rejects(
            () => buildService().previewCancel(CTX, { subscriptionBundleId: booking.id }, NOW),
            /nicht gefunden/,
        );
    });
});

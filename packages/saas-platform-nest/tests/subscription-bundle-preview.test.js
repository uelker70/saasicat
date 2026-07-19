import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlePreviewService } from '../dist/billing/index.js';
import {
    FakeBundleRepository,
    FakePlanRepository,
    FakeSubscriptionBundleRepository,
} from '../dist/testing/index.js';

// SubscriptionBundlePreviewService (#37) — Add-/Cancel-Vorschau mit
// Proration (geteilter computeProration-Helper), Redundanz-Hinweis
// (sakarel AK-13), requires-Dependency-Check (#35) und Self-Service-Policy.

const PROJECT = 'vereinsfux';
const SUB_A = 'sub-a';
const NOW = new Date('2026-05-17T00:00:00Z');

// Mai 2026: 31 Periodentage, ab 17.05. verbleiben 15 Tage.
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
    test('Proration: anteiliger Betrag bis Periodenende + Folgeperioden-Preis', async () => {
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

    test('YEARLY-Cycle nutzt yearlyNet, plan-spezifischer Pricing-Override gewinnt', async () => {
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

    test('TRIAL: keine Proration (noch keine bezahlte Periode)', async () => {
        const bv = await createPublishedBundle({ key: 'B1' });
        const dto = await buildService().previewAdd(
            { ...CTX, status: 'TRIAL' },
            { bundleVersionId: bv.id },
            NOW,
        );
        assert.equal(dto.proration, null);
        assert.equal(dto.nextPeriodPriceNet, 31);
    });

    test('Mindestlaufzeit: Default 12 Monate ab now, 0 = keine', async () => {
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

    test('Redundanz (AK-13): Feature bereits im Plan → Hinweis + Warning', async () => {
        const bv = await createPublishedBundle({ key: 'B1', features: ['WHATSAPP', 'NEU'] });
        const dto = await buildService().previewAdd(CTX, { bundleVersionId: bv.id }, NOW);

        assert.deepEqual(dto.redundantFeatures, [
            { featureKey: 'WHATSAPP', coveredBy: 'PLAN', coveredByKey: 'PRO' },
        ]);
        assert.ok(dto.warnings.some((w) => w.code === 'REDUNDANT_FEATURES'));
    });

    test('Redundanz: Feature bereits in anderem aktiven Bundle → Hinweis mit bundleKey', async () => {
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

    test('requires (#35): ungedeckte Abhängigkeit → missingRequires + Blocker', async () => {
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

    test('requires: Deckung durch Plan oder aktives Bundle → kein Blocker', async () => {
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

    test('requires: ohne CatalogEntryRepository kein Check (graceful)', async () => {
        const bv = await createPublishedBundle({
            key: 'TURNIERE',
            features: ['TOURNAMENT_MANAGEMENT'],
        });
        const dto = await buildService().previewAdd(CTX, { bundleVersionId: bv.id }, NOW);
        assert.deepEqual(dto.missingRequires, []);
    });

    test('Self-Service-Policy: Vertriebs-only-Bundle → Blocker BUNDLE_NOT_SELF_SERVICE', async () => {
        const bv = await createPublishedBundle({ key: 'ENTERPRISE_PACK' });
        const dto = await buildService({
            blockedBundles: { bundleKeys: ['ENTERPRISE_PACK'] },
        }).previewAdd(CTX, { bundleVersionId: bv.id }, NOW);
        assert.ok(dto.blockers.some((b) => b.code === 'BUNDLE_NOT_SELF_SERVICE'));
    });

    test('Blocker: plan-inkompatibel + bereits gebucht', async () => {
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

    test('unbekannte BundleVersion → NotFound', async () => {
        await assert.rejects(
            () => buildService().previewAdd(CTX, { bundleVersionId: 'nope' }, NOW),
            /nicht gefunden/,
        );
    });
});

describe('SubscriptionBundlePreviewService — previewCancel', () => {
    test('effectiveAt = Periodenende, wenn Mindestlaufzeit abgelaufen', async () => {
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

    test('Mindestlaufzeit bindet über Periodenende hinaus → effectiveAt + Warning', async () => {
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

    test('bereits gekündigt → Blocker', async () => {
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

    test('fremde Subscription → NotFound (kein Cross-Tenant-Leak)', async () => {
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

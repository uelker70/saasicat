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
    // Nothing ends this plan, so nothing caps a bundle booked on it.
    parentEndsAt: null,
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

function buildService({
    catalogEntryRepo = null,
    blockedBundles = null,
    plans = planRepo,
    ...config
} = {}) {
    return new SubscriptionBundlePreviewService(
        subBundleRepo,
        bundleRepo,
        plans,
        catalogEntryRepo,
        blockedBundles,
        config,
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

    test('the preview quotes no commitment, because a booking makes none', async () => {
        // What the tenant is shown before agreeing has to be what the booking
        // writes — `bundle-price.ts` demands that of prices and it holds for
        // terms too. A preview naming a commitment the booking does not create
        // describes a different contract from the one signed.
        const bv = await createPublishedBundle({ key: 'B1' });
        const dto = await buildService().previewAdd(CTX, { bundleVersionId: bv.id }, NOW);
        assert.equal(dto.minimumTermMonths, 0);
        assert.equal(dto.minimumTermEndsAt, null);
    });

    test('the preview quotes a commitment an operator configured', async () => {
        const bv = await createPublishedBundle({ key: 'B1c' });
        const dto = await buildService({ defaultMinimumTermMonths: 12 }).previewAdd(
            CTX,
            { bundleVersionId: bv.id },
            NOW,
        );
        assert.equal(dto.minimumTermMonths, 12);
        assert.equal(dto.minimumTermEndsAt.toISOString(), '2027-05-17T00:00:00.000Z');
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
            /not found/,
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
        assert.ok(dto.blockers.some((b) => b.code === 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED'));
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
            /not found/,
        );
    });
});

describe('a bundle billed in its own rhythm', () => {
    // The booking route has taken a `billingCycle` since bundles gained a
    // rhythm of their own; the preview did not, and quoted the plan's. A tenant
    // asking for a monthly bundle beside a yearly plan was shown the yearly
    // price, prorated across the plan's year, and then charged the monthly one.
    // A preview that describes a different contract from the one written is the
    // one thing a preview may never do.

    const YEARLY_CTX = {
        ...CTX,
        billingCycle: 'YEARLY',
        currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
        currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
        planAnchorDay: 1,
    };

    test('a monthly bundle on a yearly plan is quoted monthly, over its own month', async () => {
        const bv = await createPublishedBundle({
            key: 'B-CYCLE',
            monthlyNet: '31.00',
            yearlyNet: '310.00',
        });
        const dto = await buildService().previewAdd(
            YEARLY_CTX,
            { bundleVersionId: bv.id, billingCycle: 'MONTHLY' },
            NOW,
        );

        assert.equal(dto.billingCycle, 'MONTHLY');
        assert.equal(dto.nextPeriodPriceNet, 31);
        // May, not the plan's year: 31 days, 15 of them still to come.
        assert.equal(dto.proration.daysInPeriod, 31);
        assert.equal(dto.proration.daysRemainingInPeriod, 15);
        assert.equal(dto.proration.targetPriceNet, 31);
        assert.equal(dto.firstPeriodEnd.toISOString().slice(0, 10), '2026-06-01');
    });

    test('without a cycle it still quotes the plan’s', async () => {
        const bv = await createPublishedBundle({
            key: 'B-DEFAULT',
            monthlyNet: '31.00',
            yearlyNet: '310.00',
        });
        const dto = await buildService().previewAdd(YEARLY_CTX, { bundleVersionId: bv.id }, NOW);

        assert.equal(dto.billingCycle, 'YEARLY');
        assert.equal(dto.nextPeriodPriceNet, 310);
        assert.equal(dto.proration.daysInPeriod, 365);
        assert.equal(dto.firstPeriodEnd.toISOString().slice(0, 10), '2027-01-01');
    });

    test('a yearly bundle beside a monthly plan is refused, not quoted', async () => {
        const bv = await createPublishedBundle({ key: 'B-TOOLONG', yearlyNet: '310.00' });
        const dto = await buildService().previewAdd(
            CTX,
            { bundleVersionId: bv.id, billingCycle: 'YEARLY' },
            NOW,
        );

        assert.ok(
            dto.blockers.some((b) => b.code === 'BUNDLE_CYCLE_EXCEEDS_PLAN'),
            `expected a cycle blocker, got ${JSON.stringify(dto.blockers)}`,
        );
    });

    test('a bundle with no price in the asked rhythm is refused, not given away', async () => {
        // Published with a yearly price only — legitimate, and the publish gate
        // passes it. What it cannot do is answer a monthly request.
        const bv = await createPublishedBundle({
            key: 'B-YEARLY-ONLY',
            monthlyNet: null,
            yearlyNet: '310.00',
        });
        const dto = await buildService().previewAdd(
            YEARLY_CTX,
            { bundleVersionId: bv.id, billingCycle: 'MONTHLY' },
            NOW,
        );

        assert.equal(dto.nextPeriodPriceNet, null);
        assert.equal(dto.proration, null);
        assert.ok(
            dto.blockers.some((b) => b.code === 'BUNDLE_NOT_PRICED_FOR_THIS_PLAN'),
            `expected a pricing blocker, got ${JSON.stringify(dto.blockers)}`,
        );
    });

    test('the preview names the day the plan takes the bundle down with it', async () => {
        const bv = await createPublishedBundle({ key: 'B-ENDING', monthlyNet: '31.00' });
        const endsAt = new Date('2026-08-01T00:00:00Z');
        const dto = await buildService().previewAdd(
            { ...CTX, parentEndsAt: endsAt },
            { bundleVersionId: bv.id },
            NOW,
        );

        assert.equal(dto.endsWithPlanAt.toISOString(), endsAt.toISOString());
        // And the term it commits to cannot outlive that day.
        assert.ok(dto.minimumTermEndsAt <= endsAt);
    });

    test('a plan that runs on names no end at all', async () => {
        const bv = await createPublishedBundle({ key: 'B-OPEN', monthlyNet: '31.00' });
        const dto = await buildService().previewAdd(CTX, { bundleVersionId: bv.id }, NOW);

        assert.equal(dto.endsWithPlanAt, null);
    });
});

describe('where the plan’s billing day is read from', () => {
    // The anchor decides which day the bundle's periods land on, so a preview
    // reading it from the wrong place quotes a different first period from the
    // one the booking writes. Three sources, in order of authority.

    test('the stored anchor wins over the window it would be guessed from', async () => {
        const bv = await createPublishedBundle({ key: 'B-ANCHOR', monthlyNet: '31.00' });
        const dto = await buildService().previewAdd(
            {
                ...CTX,
                // The window says the 1st; the subscription is billed on the
                // 31st and February shortened its last boundary.
                currentPeriodStart: new Date('2026-04-30T00:00:00Z'),
                currentPeriodEnd: new Date('2026-05-31T00:00:00Z'),
                planAnchorDay: 31,
            },
            { bundleVersionId: bv.id },
            NOW,
        );

        assert.equal(dto.firstPeriodEnd.toISOString().slice(0, 10), '2026-05-31');
    });

    test('without one it is read from the window start, not the window end', async () => {
        // The two only differ once a short month has clamped the end, so the
        // fixture is a window that has been through one: 31 January to 28
        // February. Reading the end gives an anchor of 28 and a 31-day cycle to
        // prorate against; reading the start gives 31 and the 28 days the
        // period actually has. The end date is the same either way — which is
        // why asserting on that alone proves nothing.
        const bv = await createPublishedBundle({ key: 'B-FROM-START', monthlyNet: '28.00' });
        const dto = await buildService().previewAdd(
            {
                ...CTX,
                currentPeriodStart: new Date('2026-01-31T00:00:00Z'),
                currentPeriodEnd: new Date('2026-02-28T00:00:00Z'),
                planAnchorDay: null,
            },
            { bundleVersionId: bv.id },
            new Date('2026-02-17T00:00:00Z'),
        );

        assert.equal(dto.firstPeriodEnd.toISOString().slice(0, 10), '2026-02-28');
        assert.equal(dto.proration.daysInPeriod, 28);
        assert.equal(dto.proration.daysRemainingInPeriod, 11);
    });

    test('a plan with no paid window is quoted no period, rather than a projected one', async () => {
        // A trial, or a subscription awaiting sales. Projecting a boundary from
        // `startedAt` named a commitment the booking does not write — it passes
        // the same null through and stores no window — on a date the eventual
        // paid window need not land on.
        const bv = await createPublishedBundle({ key: 'B-NO-WINDOW', monthlyNet: '31.00' });
        const dto = await buildService().previewAdd(
            {
                ...CTX,
                startedAt: new Date('2026-01-09T00:00:00Z'),
                currentPeriodStart: null,
                currentPeriodEnd: null,
                planAnchorDay: null,
            },
            { bundleVersionId: bv.id },
            NOW,
        );

        assert.equal(dto.firstPeriodEnd, null);
        // …and nothing is prorated against a period that does not exist.
        assert.equal(dto.proration, null);
        // The price it will cost once a window opens is still worth stating.
        assert.equal(dto.nextPeriodPriceNet, 31);
    });
});

describe('what a cancellation preview quotes', () => {
    // It has to name the date the mutation will write. For a monthly bundle
    // beside a yearly plan the plan's boundary is up to eleven months past the
    // bundle's own, and quoting it told the tenant their booking would run — and
    // be billed — for most of a year they had just cancelled.

    const YEARLY_CTX = {
        ...CTX,
        billingCycle: 'YEARLY',
        currentPeriodStart: new Date('2026-01-01T00:00:00Z'),
        currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
        planAnchorDay: 1,
    };

    test('a monthly booking is quoted its own month end', async () => {
        const bv = await createPublishedBundle({ key: 'B-CANCEL-M', monthlyNet: '31.00' });
        const booking = await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            startedAt: new Date('2026-04-01T00:00:00Z'),
            minimumTermEndsAt: null,
            billingCycle: 'MONTHLY',
            currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
        });

        const dto = await buildService().previewCancel(
            YEARLY_CTX,
            { subscriptionBundleId: booking.id },
            NOW,
        );
        assert.equal(dto.effectiveAt.toISOString(), '2026-06-01T00:00:00.000Z');
        // …and the saving is a month of it, not a year.
        assert.equal(dto.nextPeriodSavingsNet, 31);
    });

    test('a booking from before the columns existed is quoted the plan’s', async () => {
        const bv = await createPublishedBundle({ key: 'B-CANCEL-LEGACY', yearlyNet: '310.00' });
        const booking = await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            startedAt: new Date('2026-01-01T00:00:00Z'),
            minimumTermEndsAt: null,
        });

        const dto = await buildService().previewCancel(
            YEARLY_CTX,
            { subscriptionBundleId: booking.id },
            NOW,
        );
        assert.equal(dto.effectiveAt.toISOString(), '2027-01-01T00:00:00.000Z');
        assert.equal(dto.nextPeriodSavingsNet, 310);
    });

    test('a minimum term running past the booking’s period still binds it', async () => {
        const bv = await createPublishedBundle({ key: 'B-CANCEL-TERM', monthlyNet: '31.00' });
        const booking = await subBundleRepo.add({
            subscriptionId: SUB_A,
            bundleVersionId: bv.id,
            startedAt: new Date('2026-04-01T00:00:00Z'),
            minimumTermEndsAt: new Date('2026-09-01T00:00:00Z'),
            billingCycle: 'MONTHLY',
            currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
            currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
        });

        const dto = await buildService().previewCancel(
            YEARLY_CTX,
            { subscriptionBundleId: booking.id },
            NOW,
        );
        assert.equal(dto.effectiveAt.toISOString(), '2026-09-01T00:00:00.000Z');
        assert.ok(
            dto.warnings.some((w) => w.code === 'MINIMUM_TERM_BINDS'),
            `expected the term warning, got ${JSON.stringify(dto.warnings)}`,
        );
    });
});

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlePreviewService } from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// A bundle preview warns a tenant who would pay twice: an add-on whose feature
// the plan already includes. Which plan it compares with is the version on
// sale — the one a booking made now would bind — not the newest published,
// which may start next month with features the tenant does not have yet.

const NOW = new Date('2026-05-17T00:00:00Z');

const CTX = {
    subscriptionId: 'sub-a',
    currentPlanKey: 'PRO',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
    parentEndsAt: null,
    planAnchorDay: 1,
};

/** A version of PRO with `features`. */
const proVersion = (id, version, features) => ({
    id,
    planId: 'PRO',
    version,
    features,
    quotas: { users: 10 },
    publishedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
});

const ON_SALE = proVersion('pv-pro-1', 1, ['CORE']);
/** Published, starting next month — the newest, and not yet on sale. */
const NEXT_MONTH = proVersion('pv-pro-2', 2, ['CORE', 'WHATSAPP']);

let bundleRepo;
let subBundleRepo;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    subBundleRepo = new FakeSubscriptionBundleRepository();
});

/** A plan repository with `onSale` on sale now and NEXT_MONTH as its newest version. */
function plansSelling(onSale) {
    const asked = [];
    return {
        asked,
        findActivePlanVersion: async (planKey, asOf) => {
            asked.push([planKey, asOf]);
            return onSale;
        },
        findLatestLivePlanVersion: async () => NEXT_MONTH,
        findById: async () => null,
    };
}

async function publishedBundle(features) {
    const bundle = await bundleRepo.create({
        bundleKey: 'ANALYTICS',
        label: 'Analytics',
    });
    const draft = await bundleRepo.createDraft({
        bundleId: bundle.id,
        features,
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

const preview = (plans, bundleVersionId) =>
    new SubscriptionBundlePreviewService(subBundleRepo, bundleRepo, plans).previewAdd(
        CTX,
        { bundleVersionId },
        NOW,
    );

const redundancyWarnings = (dto) => dto.warnings.filter((w) => w.code === 'REDUNDANT_FEATURES');

// @requirement SC-PLAN-018 — The version that applies is the one valid on the day of the purchase
// @requirement SC-PLAN-027 — The catalogue, every price and every booking name the same version at the same moment
describe('the plan a bundle preview compares with', () => {
    test('is the version on sale at the moment of the preview, not the newest published', async () => {
        const bv = await publishedBundle(['WHATSAPP']);
        const plans = plansSelling(ON_SALE);

        const dto = await preview(plans, bv.id);

        assert.equal(dto.action, 'add');
        assert.deepEqual(
            redundancyWarnings(dto),
            [],
            'WHATSAPP arrives with next month’s version; the tenant does not have it today',
        );
        assert.deepEqual(plans.asked, [['PRO', NOW]]);
    });

    test('warns where the version on sale already includes a feature of the bundle', async () => {
        const bv = await publishedBundle(['WHATSAPP']);
        const dto = await preview(plansSelling(proVersion('pv-pro-1', 1, ['WHATSAPP'])), bv.id);
        assert.equal(redundancyWarnings(dto).length, 1);
    });

    test('a bundle the plan does not cover gets no redundancy warning', async () => {
        const bv = await publishedBundle(['REPORTS']);
        const dto = await preview(plansSelling(ON_SALE), bv.id);
        assert.deepEqual(redundancyWarnings(dto), []);
    });

    test('a plan with nothing on sale leaves the hint out and still answers', async () => {
        const bv = await publishedBundle(['WHATSAPP']);
        const dto = await preview(plansSelling(null), bv.id);
        assert.equal(dto.action, 'add');
        assert.deepEqual(redundancyWarnings(dto), []);
    });

    test('with no plan repository at all it still answers', async () => {
        // A consumer that binds none: the redundancy hint cannot be computed,
        // and that is a missing hint rather than a failed request.
        const bv = await publishedBundle(['WHATSAPP']);
        const dto = await new SubscriptionBundlePreviewService(
            subBundleRepo,
            bundleRepo,
            null,
        ).previewAdd(CTX, { bundleVersionId: bv.id }, NOW);
        assert.equal(dto.action, 'add');
    });
});

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriptionBundlePreviewService } from '../dist/billing/index.js';
import { FakeBundleRepository, FakeSubscriptionBundleRepository } from '../dist/testing/index.js';

// A consumer whose schema predates the validity-window columns.
//
// The platform asks the plan repository for the version active at a moment, and
// falls back to the newest live one where that lookup is unavailable:
//
//     findActivePlanVersion?.(planKey, asOf) ?? findLatestLivePlanVersion?.(planKey)
//
// `?.` tests whether the method is THERE. It cannot test whether the method is
// willing, and `adapter-prisma` used to define it and throw inside it — so the
// guard passed, the throw escaped the service, and a tenant clicking a bundle
// in the store got HTTP 500. Seen in a running notesapp container on
// 2026-08-26; three routes reach this path, not one.
//
// The fix is in the adapter, which now offers the method only when it can
// answer. What this file pins is the platform half: the preview has to survive
// a repository that does not offer it.

const PROJECT = 'clubapp';
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

const LIVE_VERSION = {
    id: 'pv-pro-1',
    planId: 'PRO',
    version: 1,
    features: ['CORE', 'WHATSAPP'],
    quotas: { users: 10 },
    publishedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
};

let bundleRepo;
let subBundleRepo;

beforeEach(() => {
    bundleRepo = new FakeBundleRepository();
    subBundleRepo = new FakeSubscriptionBundleRepository();
});

/** A plan repository shaped like the adapter on a given schema. */
function plansOn({ offersActiveLookup }) {
    const repo = {
        findLatestLivePlanVersion: async () => LIVE_VERSION,
        findById: async () => null,
    };
    if (offersActiveLookup) repo.findActivePlanVersion = async () => LIVE_VERSION;
    return repo;
}

/** The shape the bug had: present, and throwing when called. */
function plansThatThrow() {
    return {
        findActivePlanVersion: async () => {
            throw new Error(
                'findActivePlanVersion requires schema.planVersionFields.catalog.validityWindows=true',
            );
        },
        findLatestLivePlanVersion: async () => LIVE_VERSION,
        findById: async () => null,
    };
}

async function publishedBundle(features) {
    const bundle = await bundleRepo.create({
        projectKey: PROJECT,
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

describe('a bundle preview on a schema without validity windows', () => {
    test('answers, using the newest live version for the redundancy hint', async () => {
        const bv = await publishedBundle(['WHATSAPP']);
        const dto = await preview(plansOn({ offersActiveLookup: false }), bv.id);

        assert.equal(dto.action, 'add');
        // WHATSAPP is in the plan, so the tenant is warned they would pay twice.
        // Getting that right is the whole reason the plan is read at all — an
        // answer that silently skipped it would look fine and be wrong.
        assert.deepEqual(dto.warnings.filter((w) => w.code === 'REDUNDANT_FEATURES').length, 1);
    });

    test('and the same answer as a schema that does offer the lookup', async () => {
        const bv = await publishedBundle(['WHATSAPP']);
        const older = await preview(plansOn({ offersActiveLookup: false }), bv.id);
        const newer = await preview(plansOn({ offersActiveLookup: true }), bv.id);

        assert.deepEqual(
            older.warnings.map((w) => w.code),
            newer.warnings.map((w) => w.code),
        );
    });

    test('a bundle the plan does not cover gets no redundancy warning either way', async () => {
        const bv = await publishedBundle(['REPORTS']);
        const dto = await preview(plansOn({ offersActiveLookup: false }), bv.id);
        assert.deepEqual(
            dto.warnings.filter((w) => w.code === 'REDUNDANT_FEATURES'),
            [],
        );
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

    test('a repository that offers the lookup and throws inside it is the bug itself', async () => {
        // Pinned so the shape cannot come back through another adapter. `?.`
        // cannot see this, which is precisely why the remedy belongs in the
        // adapter and not in another guard here.
        const bv = await publishedBundle(['WHATSAPP']);
        await assert.rejects(() => preview(plansThatThrow(), bv.id), /validityWindows/);
    });
});

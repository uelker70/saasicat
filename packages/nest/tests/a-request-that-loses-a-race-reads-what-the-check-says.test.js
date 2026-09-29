import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    bundleKeyTaken,
    catalogDraftExists,
    marketingProjectionTaken,
    noActivePlanVersion,
    noPendingPlanVersion,
    planKeyTaken,
    planNotInCatalog,
    subscriptionBundleAlreadyCancelled,
    subscriptionBundleGone,
    subscriptionChanged,
    subscriptionGone,
} from '@saasicat/core';
import { SubscriptionBundlesService, TenantBillingController } from '../dist/billing/index.js';
import {
    BundlesService,
    MarketingProjectionsService,
    PlanVersionsService,
    PlansService,
} from '../dist/catalog/index.js';
import {
    FakeBundleRepository,
    FakeMarketingProjectionRepository,
    FakePlanRepository,
} from '../dist/testing/index.js';

// Every case here stages the moment two requests pass the platform's check
// together: the check finds nothing in the way, and the store refuses because
// the other request wrote first. The loser has to read what a request arriving
// a moment later reads from the check — its status, its code and its params —
// and not a 500 that looks like a crash in the log.

/** An `assert.rejects` validator for an answer with this status, code and params. */
function answeredWith(status, code, params) {
    return (error) => {
        assert.equal(error.getStatus?.(), status, String(error));
        const body = error.getResponse();
        assert.equal(body.code, code);
        if (params !== undefined) assert.deepEqual(body.params, params);
        return true;
    };
}

// @requirement SC-OPS-016 — A request that loses a race reads what the check says, not a server error
describe('an operator who creates in the catalogue a moment after another', () => {
    test('is told the plan key is taken, as the check says it', async () => {
        const repo = new FakePlanRepository();
        repo.findByKey = async () => null;
        repo.create = async (data) => {
            throw planKeyTaken(data.planKey);
        };

        await assert.rejects(
            new PlansService(repo).createPlan({ planKey: 'PRO', label: 'Pro' }),
            answeredWith(422, 'PLAN_ALREADY_EXISTS', { planKey: 'PRO' }),
        );
    });

    test('is told the bundle key is taken, as the check says it', async () => {
        const repo = new FakeBundleRepository();
        repo.findByKey = async () => null;
        repo.create = async (data) => {
            throw bundleKeyTaken(data.bundleKey);
        };
        const bundles = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });

        await assert.rejects(
            bundles.createBundle({ bundleKey: 'BANKING', label: 'Banking' }),
            answeredWith(422, 'BUNDLE_ALREADY_EXISTS', { bundleKey: 'BANKING' }),
        );
    });

    test('is told the marketing projection exists, with the check’s 409', async () => {
        const repo = new FakeMarketingProjectionRepository();
        repo.findByTarget = async () => null;
        const target = { targetType: 'plan', targetVersionId: 'pv-1', locale: 'de' };
        repo.create = async () => {
            throw marketingProjectionTaken(target);
        };

        await assert.rejects(
            new MarketingProjectionsService(repo).create({
                ...target,
                displayLabel: 'Pro',
                description: '',
            }),
            answeredWith(409, 'MARKETING_PROJECTION_ALREADY_EXISTS', target),
        );
    });

    test('is told the plan has a draft, naming it', async () => {
        const repo = new FakePlanRepository();
        const plan = await new PlansService(repo).createPlan({ planKey: 'PRO', label: 'Pro' });
        repo.findCurrentDraft = async () => null;
        repo.createPlanVersionDraft = async (data) => {
            throw catalogDraftExists('PlanVersion', data.planId, 3);
        };
        const versions = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });

        await assert.rejects(
            versions.createPlanDraft({
                planId: plan.id,
                features: [],
                quotas: {},
                monthlyNet: '5.00',
                yearlyNet: '50.00',
            }),
            answeredWith(422, 'PLAN_DRAFT_ALREADY_EXISTS', { planKey: 'PRO', draftVersion: 3 }),
        );
    });

    test('is told the plan is not found where it was retired in the meantime', async () => {
        const repo = new FakePlanRepository();
        const plan = await new PlansService(repo).createPlan({ planKey: 'PRO', label: 'Pro' });
        repo.createPlanVersionDraft = async (data) => {
            throw planNotInCatalog(data.planId);
        };
        const versions = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' });

        await assert.rejects(
            versions.createPlanDraft({
                planId: plan.id,
                features: [],
                quotas: {},
                monthlyNet: '5.00',
                yearlyNet: '50.00',
            }),
            answeredWith(404, 'PLAN_NOT_FOUND', { planId: plan.id }),
        );
    });

    test('is told the bundle has a draft, naming it', async () => {
        const repo = new FakeBundleRepository();
        const bundles = new BundlesService(repo, null, { strictModeCheckMode: 'warn-only' });
        const bundle = await bundles.createBundle({ bundleKey: 'BANKING', label: 'Banking' });
        repo.findCurrentDraft = async () => null;
        repo.createDraft = async () => {
            throw catalogDraftExists('BundleVersion', 'BANKING', 2);
        };

        await assert.rejects(
            bundles.createBundleDraft({ bundleId: bundle.id, features: [] }),
            answeredWith(422, 'BUNDLE_DRAFT_ALREADY_EXISTS', {
                bundleKey: 'BANKING',
                draftVersion: 2,
            }),
        );
    });

    test('meets any other failure of the store unchanged', async () => {
        const repo = new FakePlanRepository();
        repo.findByKey = async () => null;
        const outage = new Error('connection reset');
        repo.create = async () => {
            throw outage;
        };

        await assert.rejects(
            new PlansService(repo).createPlan({ planKey: 'PRO', label: 'Pro' }),
            (error) => error === outage,
        );
    });
});

// @requirement SC-OPS-016 — A request that loses a race reads what the check says, not a server error
describe('a tenant who cancels an add-on a moment after another request', () => {
    const BOOKING = {
        id: 'sb-1',
        canceledAt: null,
        currentPeriodEnd: new Date('2099-02-01T00:00:00.000Z'),
        minimumTermEndsAt: null,
    };

    function cancelWith(refusal) {
        const repo = {
            findById: async () => BOOKING,
            cancel: async () => {
                throw refusal;
            },
        };
        return new SubscriptionBundlesService(
            repo,
            new FakeBundleRepository(),
        ).cancelBundleFromSubscription({ subscriptionBundleId: BOOKING.id, parentEndsAt: null });
    }

    test('is told it is already cancelled, as the check says it', async () => {
        await assert.rejects(
            cancelWith(subscriptionBundleAlreadyCancelled(BOOKING.id)),
            answeredWith(422, 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED', {
                subscriptionBundleId: BOOKING.id,
            }),
        );
    });

    test('is told it is not found where it went', async () => {
        await assert.rejects(
            cancelWith(subscriptionBundleGone(BOOKING.id)),
            answeredWith(404, 'SUBSCRIPTION_BUNDLE_NOT_FOUND', {
                subscriptionBundleId: BOOKING.id,
            }),
        );
    });
});

const SUBSCRIPTION = {
    id: 'sub-1',
    plan: 'STANDARD',
    billingCycle: 'MONTHLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: new Date('2026-01-01'),
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date('2099-01-01'),
    minimumTermUntil: null,
    canceledAt: null,
    canceledEffectiveAt: null,
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: null,
    pendingPlanVersion: { id: 'pv-2', version: 2 },
    pendingPlanVersionEffectiveAt: null,
    pendingPlanVersionAccepted: false,
    pendingPlanVersionAcceptedAt: null,
};

const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

/** The controller over a subscription the checks accept and a store that refuses. */
function billingOver(port, decision = { isImmediate: false, effectiveAt: null, blockers: [] }) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STANDARD', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        { preview: async () => decision },
        { findForTenant: async () => SUBSCRIPTION },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
    );
}

// @requirement SC-OPS-016 — A request that loses a race reads what the check says, not a server error
describe('a tenant whose subscription moves while the request is decided', () => {
    test('accepting a pending version cleared meanwhile answers as the check does', async () => {
        const port = {
            acceptPendingPlanVersion: async (tenantId) => {
                throw noPendingPlanVersion(tenantId);
            },
        };
        await assert.rejects(
            billingOver(port).acceptPendingPlanVersion(request),
            answeredWith(400, 'NO_PENDING_PLAN_VERSION'),
        );
    });

    test('accepting a pending version replaced meanwhile is told to reload', async () => {
        const port = {
            acceptPendingPlanVersion: async (tenantId) => {
                throw subscriptionChanged(tenantId);
            },
        };
        await assert.rejects(
            billingOver(port).acceptPendingPlanVersion(request),
            answeredWith(409, 'SUBSCRIPTION_CHANGED'),
        );
    });

    test('cancelling a subscription gone meanwhile answers as the check does', async () => {
        const port = {
            cancelSubscription: async (tenantId) => {
                throw subscriptionGone(tenantId);
            },
        };
        await assert.rejects(
            billingOver(port).cancelSubscription(request, {}),
            answeredWith(404, 'NO_SUBSCRIPTION'),
        );
    });

    test('an immediate plan change whose target lost its version answers as not found', async () => {
        const port = {
            changePlanImmediate: async (_tenantId, input) => {
                throw noActivePlanVersion(input.planId, new Date('2026-05-01T00:00:00.000Z'));
            },
        };
        const immediate = { isImmediate: true, effectiveAt: new Date(), blockers: [] };
        await assert.rejects(
            billingOver(port, immediate).changePlan(request, {
                plan: 'PRO',
                billingCycle: 'MONTHLY',
            }),
            answeredWith(404, 'NO_ACTIVE_PLAN_VERSION', { planId: 'PRO', asOf: '2026-05-01' }),
        );
    });
});

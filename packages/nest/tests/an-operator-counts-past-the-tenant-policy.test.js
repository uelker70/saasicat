import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Test } from '@nestjs/testing';

import {
    AUDIT_STATS_PORT_TOKEN,
    AdminStatsService,
    PROMO_CODE_STATS_PORT_TOKEN,
    RLS_BYPASS_PORT_TOKEN,
    SUBSCRIPTION_STATS_PORT_TOKEN,
} from '../dist/admin/index.js';
import {
    BUNDLE_REPOSITORY_TOKEN,
    BundlesService,
    CATALOG_SERVICE_CONFIG_TOKEN,
    PLAN_REPOSITORY_TOKEN,
    PlanVersionsService,
    PlansService,
} from '../dist/catalog/index.js';
import { SUBSCRIPTION_REPOSITORY_TOKEN } from '../dist/entitlement/index.js';
import {
    FakeBundleRepository,
    FakePlanRepository,
    FakeSubscriptionRepository,
} from '../dist/testing/index.js';

// An installation that keeps its tenants apart with a row-level policy, seen
// from an operator's request: no tenant is selected, so the policy hides every
// subscription unless the read runs inside the bypass frame. A count it hides
// comes back as 0, which is indistinguishable from nobody — and for the edit
// lock on a published version, nobody is the one answer that opens it.
//
// The services are resolved through Nest rather than constructed by hand, so
// what is proven is that each of them asks for the bypass port by its token.

const FUTURE = '2099-01-01';
const HIDDEN_SUBSCRIBERS = 40;

/** The policy, and the frame that lifts it. */
class TenantPolicy {
    #frame = new AsyncLocalStorage();

    bypass = { runWithBypass: (read) => this.#frame.run(true, read) };

    hidesRows() {
        return this.#frame.getStore() !== true;
    }
}

class SubscriptionsUnderPolicy extends FakeSubscriptionRepository {
    constructor(policy) {
        super();
        this.policy = policy;
    }

    async countByPlanVersionId(planVersionId) {
        return this.policy.hidesRows() ? 0 : super.countByPlanVersionId(planVersionId);
    }

    async countByBundleVersionId(bundleVersionId) {
        return this.policy.hidesRows() ? 0 : super.countByBundleVersionId(bundleVersionId);
    }

    async countActiveByPlanKey() {
        return this.policy.hidesRows() ? {} : { STARTER: HIDDEN_SUBSCRIBERS };
    }
}

async function anInstallationUnderPolicy() {
    const policy = new TenantPolicy();
    const subscriptions = new SubscriptionsUnderPolicy(policy);
    const shown = (figure) => (policy.hidesRows() ? 0 : figure);
    const moduleRef = await Test.createTestingModule({
        providers: [
            PlansService,
            PlanVersionsService,
            BundlesService,
            AdminStatsService,
            { provide: PLAN_REPOSITORY_TOKEN, useValue: new FakePlanRepository() },
            { provide: BUNDLE_REPOSITORY_TOKEN, useValue: new FakeBundleRepository() },
            { provide: SUBSCRIPTION_REPOSITORY_TOKEN, useValue: subscriptions },
            {
                provide: CATALOG_SERVICE_CONFIG_TOKEN,
                useValue: { strictModeCheckMode: 'warn-only' },
            },
            {
                provide: SUBSCRIPTION_STATS_PORT_TOKEN,
                useValue: {
                    getStats: async () => ({
                        total: shown(HIDDEN_SUBSCRIBERS),
                        pilots: 0,
                        trialing: 0,
                        byPlan: {},
                        byStatus: {},
                    }),
                },
            },
            {
                provide: PROMO_CODE_STATS_PORT_TOKEN,
                useValue: { getStats: async () => ({ total: shown(3), byStatus: {}, top: null }) },
            },
            {
                provide: AUDIT_STATS_PORT_TOKEN,
                useValue: { countSince: async () => shown(12) },
            },
            { provide: RLS_BYPASS_PORT_TOKEN, useValue: policy.bypass },
        ],
    }).compile();
    return {
        subscriptions,
        plans: moduleRef.get(PlansService),
        planVersions: moduleRef.get(PlanVersionsService),
        bundles: moduleRef.get(BundlesService),
        stats: moduleRef.get(AdminStatsService),
    };
}

// @requirement SC-PLAN-005 — A version somebody has already bought cannot be edited
// @requirement SC-SEC-003 — Reads that legitimately cross tenants are named as the exceptions they are
describe('a plan version subscribers are on, behind a tenant policy', () => {
    async function aPublishedFutureVersionWithSubscribers() {
        const installation = await anInstallationUnderPolicy();
        const plan = await installation.plans.createPlan({ planKey: 'STARTER', label: 'Starter' });
        const draft = await installation.planVersions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const { planVersion } = await installation.planVersions.publishPlanVersion(
            draft.planVersion.id,
            { publishedByUserId: null, validFrom: FUTURE },
        );
        installation.subscriptions.setPlanVersionCount(planVersion.id, HIDDEN_SUBSCRIBERS);
        return { ...installation, plan, planVersion };
    }

    test('stays locked against editing', async () => {
        const { planVersions, planVersion } = await aPublishedFutureVersionWithSubscribers();

        await assert.rejects(
            () => planVersions.updatePlanDraft(planVersion.id, { monthlyNet: '7.00' }),
            (error) => error.getResponse().code === 'PLAN_VERSION_NOT_EDITABLE',
        );
    });

    test('is listed with the subscribers the policy hides from the request', async () => {
        const { planVersions, plan } = await aPublishedFutureVersionWithSubscribers();

        const [listed] = await planVersions.listPlanVersions(plan.id);

        assert.equal(listed.subscriptionCount, HIDDEN_SUBSCRIBERS);
    });
});

// @requirement SC-BUN-024 — An add-on version somebody has already booked cannot be edited
// @requirement SC-SEC-003 — Reads that legitimately cross tenants are named as the exceptions they are
describe('an add-on version tenants have booked, behind a tenant policy', () => {
    test('stays locked against editing', async () => {
        const { bundles, subscriptions } = await anInstallationUnderPolicy();
        const bundle = await bundles.createBundle({ bundleKey: 'BANKING', label: 'Banking' });
        const draft = await bundles.createBundleDraft({
            bundleId: bundle.id,
            monthlyNet: '9.90',
            features: ['A'],
        });
        const { bundleVersion } = await bundles.publishBundleVersion(draft.bundleVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        subscriptions.setBundleVersionCount(bundleVersion.id, HIDDEN_SUBSCRIBERS);

        await assert.rejects(
            () => bundles.updateBundleDraft(bundleVersion.id, { monthlyNet: '12.00' }),
            (error) => error.getResponse().code === 'BUNDLE_VERSION_NOT_EDITABLE',
        );
    });
});

// @requirement SC-SEC-003 — Reads that legitimately cross tenants are named as the exceptions they are
describe("the operator's figures, behind a tenant policy", () => {
    test('the plan list counts the tenants on each plan', async () => {
        const { plans } = await anInstallationUnderPolicy();

        assert.deepEqual(await plans.getTenantCounts(), { STARTER: HIDDEN_SUBSCRIBERS });
    });

    test('the dashboard reads subscriptions, promo codes and the audit trail', async () => {
        const { stats } = await anInstallationUnderPolicy();

        const snapshot = await stats.getSnapshot();

        assert.equal(snapshot.subscriptions.total, HIDDEN_SUBSCRIBERS);
        assert.equal(snapshot.promos.total, 3);
        assert.equal(snapshot.audit.countLastNDays, 12);
    });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlanVersionsService, PlansService } from '../dist/catalog/index.js';
import { FakePlanRepository, FakeSubscriptionRepository } from '../dist/testing/index.js';

// PlanVersionsService — PlanVersion lifecycle (SPEC_V2 §11.1 M6 Pack 2a).
// Strict mode check is inactive in Pack 2a (`warnings` is always empty);
// comes with Pack 2c.

const PROJECT = 'clubapp';

async function setupWithPlan(planKey = 'STARTER', subscriptions = null) {
    const repo = new FakePlanRepository();
    const stem = new PlansService(repo);
    const versions = new PlanVersionsService(repo, null, { strictModeCheckMode: 'warn-only' }, subscriptions);
    const plan = await stem.createPlan({
        projectKey: PROJECT,
        planKey,
        label: planKey,
    });
    return { repo, stem, versions, plan, subscriptions };
}

describe('PlanVersionsService — Lifecycle', () => {
    test('createPlanDraft + listPlanVersions returns v1 with publishedAt=null', async () => {
        const { versions, plan } = await setupWithPlan();
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['MEMBER_MGMT'],
            quotas: { members: 100 },
            monthlyNet: '9.90',
            yearlyNet: '99.00',
            changeNote: 'Initial v1',
        });
        assert.equal(result.planVersion.version, 1);
        assert.equal(result.planVersion.publishedAt, null);
        assert.equal(result.planVersion.planId, 'STARTER');
        assert.deepEqual(result.warnings, []);

        const list = await versions.listPlanVersions(plan.id);
        assert.equal(list.length, 1);
        assert.equal(list[0].id, result.planVersion.id);
    });

    test('createPlanDraft: second draft → UnprocessableEntity (max 1 draft)', async () => {
        const { versions, plan } = await setupWithPlan();
        await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await assert.rejects(
            () =>
                versions.createPlanDraft({
                    planId: plan.id,
                    features: ['B'],
                    quotas: {},
                    monthlyNet: '6.00',
                    yearlyNet: '60.00',
                }),
            (err) => {
                assert.equal(err.status, 422);
                return true;
            },
        );
    });

    test('createPlanDraft: unknown plan → NotFound', async () => {
        const { versions } = await setupWithPlan();
        await assert.rejects(
            () =>
                versions.createPlanDraft({
                    planId: 'not-existing-uuid',
                    features: [],
                    quotas: {},
                    monthlyNet: '1.00',
                    yearlyNet: '10.00',
                }),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('updatePlanDraft: changes features + quotas', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: { members: 50 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const updated = await versions.updatePlanDraft(draft.planVersion.id, {
            features: ['A', 'B'],
            quotas: { members: 100 },
            monthlyNet: '7.00',
        });
        assert.deepEqual(updated.planVersion.features, ['A', 'B']);
        assert.equal(updated.planVersion.quotas.members, 100);
        assert.equal(updated.planVersion.monthlyNet, '7.00');
    });

    test('createPlanDraft: bundles default to [] when not provided', async () => {
        const { versions, plan } = await setupWithPlan();
        const result = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.deepEqual(result.planVersion.bundles, []);
    });

    test('createPlanDraft + updatePlanDraft: bundles are persisted', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            bundles: ['COMMUNICATION_PRO'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        assert.deepEqual(draft.planVersion.bundles, ['COMMUNICATION_PRO']);

        const updated = await versions.updatePlanDraft(draft.planVersion.id, {
            bundles: ['COMMUNICATION_PRO', 'FINANCE_PLUS'],
        });
        assert.deepEqual(updated.planVersion.bundles, ['COMMUNICATION_PRO', 'FINANCE_PLUS']);
        // features stay unchanged when only bundles are provided
        assert.deepEqual(updated.planVersion.features, ['A', 'B']);

        const list = await versions.listPlanVersions(plan.id);
        assert.deepEqual(list[0].bundles, ['COMMUNICATION_PRO', 'FINANCE_PLUS']);
    });

    test('updatePlanDraft: published version → UnprocessableEntity', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: [],
            quotas: {},
            monthlyNet: '1.00',
            yearlyNet: '10.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        await assert.rejects(
            () =>
                versions.updatePlanDraft(draft.planVersion.id, {
                    features: ['NEW'],
                }),
            (err) => {
                assert.equal(err.status, 422);
                return true;
            },
        );
    });

    test('publishPlanVersion: first version → publishedAt + nonRegressive=true', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        assert.notEqual(published.planVersion.publishedAt, null);
        assert.equal(published.planVersion.nonRegressive, true);
        assert.equal(published.planVersion.validFrom?.slice(0, 10), '2026-01-01');
    });

    test('publishPlanVersion: price 0.00 → 422 PLAN_VERSION_ZERO_PRICE (seed placeholder protection)', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '0.00',
            yearlyNet: '0.00',
        });
        await assert.rejects(
            () =>
                versions.publishPlanVersion(draft.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-01-01',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_ZERO_PRICE');
                return true;
            },
        );
        // allowZeroPrice allows the special case (e.g. ENTERPRISE):
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
            allowZeroPrice: true,
        });
        assert.notEqual(published.planVersion.publishedAt, null);
    });

    test('publishPlanVersion: second version sets previous to supersededAt', async () => {
        const { versions, plan } = await setupWithPlan();
        // v1 → publish
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        // v2 (additive → nonRegressive)
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
            changeNote: 'Add B',
        });
        const published2 = await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        assert.notEqual(published2.planVersion.publishedAt, null);

        const list = await versions.listPlanVersions(plan.id);
        const v1After = list.find((v) => v.id === v1.planVersion.id);
        assert.notEqual(v1After.supersededAt, null, 'v1 must be superseded');
        // Auto succession: validUntil(v1) = validFrom(v2) - 1 day = 2026-05-31.
        assert.equal(v1After.validUntil?.slice(0, 10), '2026-05-31');
        const v2After = list.find((v) => v.id === v2.planVersion.id);
        assert.equal(v2After.supersededAt, null, 'v2 must be live');
        assert.equal(v2After.validUntil, null, 'v2 is the latest version → unlimited');
    });

    test('publishPlanVersion: validFrom must be strictly after predecessor → 422', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
            changeNote: 'Add B',
        });
        await assert.rejects(
            () =>
                versions.publishPlanVersion(v2.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-06-01', // == predecessor, not strictly after
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS');
                return true;
            },
        );
    });

    test('publishPlanVersion: without validFrom → 422 PLAN_VERSION_VALID_FROM_REQUIRED', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await assert.rejects(
            () =>
                versions.publishPlanVersion(draft.planVersion.id, {
                    publishedByUserId: null,
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_VALID_FROM_REQUIRED');
                return true;
            },
        );
    });

    test('publishPlanVersion: regressive version (feature removed) → 422 without forceRegressive', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: { users: 10 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        // v2 without feature B → regressive
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: { users: 10 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
            changeNote: 'Remove B',
        });
        await assert.rejects(
            () =>
                versions.publishPlanVersion(v2.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-06-01',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_REGRESSION');
                return true;
            },
        );
    });

    test('publishPlanVersion: forceRegressive lets regressive version through', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
            changeNote: 'Force-Remove B',
        });
        const published = await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            forceRegressive: true,
            validFrom: '2026-06-01',
        });
        assert.notEqual(published.planVersion.publishedAt, null);
        // changes list contains the removed feature
        assert.ok(
            (published.planVersion.publishedChanges ?? []).length > 0,
            'publishedChanges should contain the diff',
        );
    });

    test('getPlanVersion: NotFound for unknown ID', async () => {
        const { versions } = await setupWithPlan();
        await assert.rejects(
            () => versions.getPlanVersion('not-existing'),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('discardPlanDraft: draft → removed, listPlanVersions returns empty list', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.discardPlanDraft(draft.planVersion.id);
        const list = await versions.listPlanVersions(plan.id);
        assert.equal(list.length, 0);
    });

    test('discardPlanDraft: published version → 422 PLAN_VERSION_ALREADY_PUBLISHED', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        await assert.rejects(
            () => versions.discardPlanDraft(draft.planVersion.id),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_ALREADY_PUBLISHED');
                return true;
            },
        );
    });

    test('discardPlanDraft: NotFound for unknown ID', async () => {
        const { versions } = await setupWithPlan();
        await assert.rejects(
            () => versions.discardPlanDraft('00000000-0000-0000-0000-000000000000'),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    // ── SPEC_V2 §4.2.1 rule 3 — gapless succession ──
    test('publishPlanVersion: gapless when predecessor has validUntil — successor must start the next day', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
            validUntil: '2026-05-31',
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        // 2026-06-15 leaves a 14-day gap — must be blocked.
        await assert.rejects(
            () =>
                versions.publishPlanVersion(v2.planVersion.id, {
                    publishedByUserId: null,
                    validFrom: '2026-06-15',
                }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_VALID_FROM_NOT_GAPLESS');
                assert.equal(err.response.requiredValidFrom, '2026-06-01');
                return true;
            },
        );
        // 2026-06-01 is the correct seamless continuation.
        const published = await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        assert.equal(published.planVersion.validFrom?.slice(0, 10), '2026-06-01');
    });

    // ── terminate (end plan version with endsAt) ──
    test('terminatePlanVersion: live version gets endsAt set', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const terminated = await versions.terminatePlanVersion(draft.planVersion.id, future);
        assert.equal(terminated.endsAt, future.toISOString());
        // supersededAt must NOT be set (no auto-succession path).
        assert.equal(terminated.supersededAt, null);
        assert.notEqual(terminated.publishedAt, null);
    });

    test('terminatePlanVersion: idempotent — second call overwrites', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const future1 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const future2 = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
        await versions.terminatePlanVersion(draft.planVersion.id, future1);
        const second = await versions.terminatePlanVersion(draft.planVersion.id, future2);
        assert.equal(second.endsAt, future2.toISOString());
    });

    test('terminatePlanVersion: date in the past → 422 PLAN_TERMINATE_DATE_NOT_FUTURE', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const past = new Date(Date.now() - 60 * 1000);
        await assert.rejects(
            () => versions.terminatePlanVersion(draft.planVersion.id, past),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_TERMINATE_DATE_NOT_FUTURE');
                return true;
            },
        );
    });

    test('terminatePlanVersion: draft (publishedAt=null) → 422 PLAN_VERSION_NOT_LIVE', async () => {
        const { versions, plan } = await setupWithPlan();
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await assert.rejects(
            () => versions.terminatePlanVersion(draft.planVersion.id, future),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_NOT_LIVE');
                return true;
            },
        );
    });

    test('terminatePlanVersion: superseded version → 422 PLAN_VERSION_NOT_LIVE', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-06-01',
        });
        // v1 is now superseded.
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await assert.rejects(
            () => versions.terminatePlanVersion(v1.planVersion.id, future),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response.code, 'PLAN_VERSION_NOT_LIVE');
                return true;
            },
        );
    });

    test('terminatePlanVersion: NotFound for unknown ID', async () => {
        const { versions } = await setupWithPlan();
        const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await assert.rejects(
            () => versions.terminatePlanVersion('not-existing', future),
            (err) => {
                assert.equal(err.status, 404);
                return true;
            },
        );
    });

    test('publishPlanVersion: gapless check not active when predecessor has no validUntil (auto succession)', async () => {
        const { versions, plan } = await setupWithPlan();
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-01-01',
            // no validUntil → null
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        // Any gap is allowed; auto succession sets
        // v1.validUntil = v2.validFrom - 1 day.
        const published = await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: '2026-09-15',
        });
        assert.equal(published.planVersion.validFrom?.slice(0, 10), '2026-09-15');
    });
});

describe('PlanVersionsService — published-but-future editing (Pack 2c)', () => {
    // Day in the far future so tests always land in the "validFrom > now"
    // range regardless of the real date.
    const FUTURE = '2099-01-01';
    const FUTURE_NEXT = '2099-06-01';

    test('updatePlanDraft allows published-but-future version (latest, 0 subs)', async () => {
        const subs = new FakeSubscriptionRepository();
        const { versions, plan } = await setupWithPlan('STARTER', subs);
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: { users: 10 },
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        // 0 subs → editable despite publishedAt != null
        const updated = await versions.updatePlanDraft(published.planVersion.id, {
            monthlyNet: '6.00',
        });
        assert.equal(updated.planVersion.monthlyNet, '6.00');
        assert.notEqual(updated.planVersion.publishedAt, null, 'published status is preserved');
    });

    test('updatePlanDraft blocks published-but-future version with subscription', async () => {
        const subs = new FakeSubscriptionRepository();
        const { versions, plan } = await setupWithPlan('STARTER', subs);
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        subs.setPlanVersionCount(published.planVersion.id, 1);
        await assert.rejects(
            () => versions.updatePlanDraft(published.planVersion.id, { monthlyNet: '7.00' }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });

    test('updatePlanDraft blocks published version that is not latest-in-chain', async () => {
        const subs = new FakeSubscriptionRepository();
        const { versions, plan } = await setupWithPlan('STARTER', subs);
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const v1Published = await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        const v2 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A', 'B'],
            quotas: {},
            // price and features additive → nonRegressive, no
            // forceRegressive needed (Pack 2c contract diff).
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        await versions.publishPlanVersion(v2.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE_NEXT,
        });
        // v1 is published-future-active but NOT latest-in-chain
        // (v2 is on top) → must stay frozen, otherwise v2 +
        // its diff against v1 become inconsistent.
        await assert.rejects(
            () => versions.updatePlanDraft(v1Published.planVersion.id, { monthlyNet: '8.00' }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });

    test('listPlanVersions annotates isLatestInChain + subscriptionCount on the latest version', async () => {
        const subs = new FakeSubscriptionRepository();
        const { versions, plan } = await setupWithPlan('STARTER', subs);
        const v1 = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const v1Published = await versions.publishPlanVersion(v1.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        subs.setPlanVersionCount(v1Published.planVersion.id, 3);

        const list = await versions.listPlanVersions(plan.id);
        const v1Row = list.find((v) => v.id === v1Published.planVersion.id);
        assert.equal(v1Row.isLatestInChain, true);
        assert.equal(v1Row.subscriptionCount, 3);
    });

    test('updatePlanDraft fail-closed without SubscriptionRepository', async () => {
        // Without a registered SubscriptionRepository the service must NOT
        // make a published-but-future version editable — otherwise a
        // production configuration sneaks past.
        const { versions, plan } = await setupWithPlan('STARTER');
        const draft = await versions.createPlanDraft({
            planId: plan.id,
            features: ['A'],
            quotas: {},
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        });
        const published = await versions.publishPlanVersion(draft.planVersion.id, {
            publishedByUserId: null,
            validFrom: FUTURE,
        });
        await assert.rejects(
            () => versions.updatePlanDraft(published.planVersion.id, { monthlyNet: '6.00' }),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'PLAN_VERSION_NOT_EDITABLE');
                return true;
            },
        );
    });
});

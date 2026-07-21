// Smoke tests for TenantBillingController.completeOnboardingSubscription.
// Instantiated directly without NestJS bootstrap; SubscriptionWritePort,
// SubscriptionUsagePort, EntitlementService, PlanChangePreviewService,
// PromoCodesService are minimally stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TenantBillingController } from '../dist/billing/index.js';

function buildEntitlement() {
    return {
        invalidations: [],
        computeLimits: async () => ({ plan: 'SPORT', quotas: {}, features: new Set() }),
        invalidateTenant(t) {
            this.invalidations.push(t);
        },
    };
}

function buildSub({ plan = 'STARTER', status = 'TRIAL', id = 'sub-1' } = {}) {
    return {
        id,
        plan,
        billingCycle: 'MONTHLY',
        status,
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: new Date('2026-06-01'),
        startedAt: new Date('2026-05-01'),
        currentPeriodStart: null,
        currentPeriodEnd: null,
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: {
            id: 'pv-1',
            planId: plan,
            version: 1,
            publishedAt: new Date('2025-01-01'),
            supersededAt: null,
            changeNote: null,
        },
        pendingPlanVersion: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
    };
}

function buildPlanPreview({ blockers = [] } = {}) {
    return {
        async assertChangeAllowed() {
            return blockers;
        },
        async preview() {
            return null;
        },
    };
}

function buildWritePort() {
    return {
        changePlanCalls: [],
        async changePlanImmediate(tenantId, input) {
            this.changePlanCalls.push({ tenantId, input });
            return { plan: input.planId, billingCycle: input.cycle };
        },
        async schedulePlanChange() {},
        async acceptPendingPlanVersion() {},
        async cancelSubscription() {
            return { canceledAt: null, status: 'ACTIVE' };
        },
    };
}

function buildPromoStub({ shouldFail = false } = {}) {
    return {
        redeemCalls: [],
        async redeem(input) {
            this.redeemCalls.push(input);
            if (shouldFail) throw new Error('Code nicht einlösbar: EXPIRED');
            return {
                id: 'red-1',
                promoCodeId: 'p1',
                subscriptionId: input.subscriptionId,
                tenantId: input.tenantId,
                appliedValueType: 'PERCENT',
                appliedValue: '20',
                appliedDurationType: 'ONCE',
                appliedDurationValue: null,
                startsAt: new Date('2026-05-10T00:00:00Z'),
                endsAt: null,
                status: 'ACTIVE',
                redeemedAt: new Date('2026-05-10T00:00:00Z'),
                reversedAt: null,
            };
        },
    };
}

function buildController(overrides = {}) {
    return new TenantBillingController(
        overrides.entitlements ?? buildEntitlement(),
        overrides.planPreview ?? buildPlanPreview(),
        overrides.subscriptionUsage ?? { findForTenant: async () => buildSub() },
        overrides.usageSnapshot ?? { snapshot: async () => ({}) },
        overrides.subscriptionWrite ?? buildWritePort(),
        overrides.tenantIdResolver ?? (() => 't1'),
        overrides.userIdResolver ?? (() => 'u1'),
        overrides.blockedPlans ?? null,
        overrides.promoCodes ?? null,
        overrides.auditService ?? null,
        overrides.userEmailResolver ?? null,
        overrides.auditContextResolver ?? null,
        overrides.subscriptionBundles ?? null,
    );
}

function buildAudit() {
    return {
        calls: [],
        async log(input) {
            this.calls.push(input);
        },
    };
}

test('onboarding sets the plan; on TRIAL the trial window is kept', async () => {
    const write = buildWritePort();
    const ent = buildEntitlement();
    const ctrl = buildController({ subscriptionWrite: write, entitlements: ent });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    assert.equal(result.plan, 'SPORT');
    assert.equal(result.billingCycle, 'YEARLY');
    assert.equal(result.promoRedemption, null);
    assert.deepEqual(result.warnings, []);

    // changePlanImmediate on TRIAL: periodStart/periodEnd null, nextStatus null
    assert.equal(write.changePlanCalls.length, 1);
    assert.equal(write.changePlanCalls[0].input.periodStart, null);
    assert.equal(write.changePlanCalls[0].input.periodEnd, null);
    assert.equal(write.changePlanCalls[0].input.nextStatus, null);

    // EntitlementCache was invalidated
    assert.deepEqual(ent.invalidations, ['t1']);
});

test('onboarding from ACTIVE status sets a new period window + ACTIVE status', async () => {
    const write = buildWritePort();
    const ctrl = buildController({
        subscriptionWrite: write,
        subscriptionUsage: {
            findForTenant: async () => buildSub({ status: 'ACTIVE' }),
        },
    });

    await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    const call = write.changePlanCalls[0].input;
    assert.ok(call.periodStart instanceof Date, 'periodStart must be a Date');
    assert.ok(call.periodEnd instanceof Date, 'periodEnd must be a Date');
    assert.equal(call.nextStatus, 'ACTIVE');
});

test('onboarding with promoCode + PromoCodesService redeems atomically', async () => {
    const write = buildWritePort();
    const promo = buildPromoStub();
    const ctrl = buildController({ subscriptionWrite: write, promoCodes: promo });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY', promoCode: 'einsteiger20' },
    );

    assert.equal(promo.redeemCalls.length, 1);
    assert.equal(promo.redeemCalls[0].subscriptionId, 'sub-1');
    assert.equal(promo.redeemCalls[0].tenantId, 't1');
    assert.equal(result.promoRedemption?.code, 'EINSTEIGER20');
    assert.equal(result.promoRedemption?.discount.valueType, 'PERCENT');
    assert.deepEqual(result.warnings, []);
});

test('onboarding without PromoCodesService reports promoCode as a warning, persists the plan anyway', async () => {
    const write = buildWritePort();
    const ctrl = buildController({ subscriptionWrite: write, promoCodes: null });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY', promoCode: 'EINSTEIGER20' },
    );

    assert.equal(write.changePlanCalls.length, 1);
    assert.equal(result.promoRedemption, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /PromoCodesModule ist nicht geladen/);
});

test('onboarding without SubscriptionUsageRecord.id reports promoCode as a warning', async () => {
    const write = buildWritePort();
    const promo = buildPromoStub();
    const ctrl = buildController({
        subscriptionWrite: write,
        promoCodes: promo,
        subscriptionUsage: {
            findForTenant: async () => {
                const sub = buildSub();
                delete sub.id;
                return sub;
            },
        },
    });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY', promoCode: 'EINSTEIGER20' },
    );

    assert.equal(promo.redeemCalls.length, 0);
    assert.equal(result.promoRedemption, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /SubscriptionUsageRecord\.id/);
});

test('onboarding on a failed promo redeem persists plan + warning', async () => {
    const write = buildWritePort();
    const promo = buildPromoStub({ shouldFail: true });
    const ctrl = buildController({ subscriptionWrite: write, promoCodes: promo });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY', promoCode: 'EXPIREDCODE' },
    );

    assert.equal(write.changePlanCalls.length, 1, 'plan was changed');
    assert.equal(result.promoRedemption, null);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /EXPIRED/);
});

test('onboarding throws ForbiddenException for blocked self-service plans', async () => {
    const ctrl = buildController({
        blockedPlans: { asTarget: ['ENTERPRISE'], asSource: [] },
    });

    await assert.rejects(
        () =>
            ctrl.completeOnboardingSubscription(
                { user: { tenantId: 't1', sub: 'u1' } },
                { plan: 'ENTERPRISE', billingCycle: 'YEARLY' },
            ),
        /ENTERPRISE wird nicht per Self-Service/,
    );
});

test('onboarding throws BadRequestException when plan-change blockers are active', async () => {
    const ctrl = buildController({
        planPreview: buildPlanPreview({ blockers: ['QUOTA_EXCEEDED:members'] }),
    });

    await assert.rejects(
        () =>
            ctrl.completeOnboardingSubscription(
                { user: { tenantId: 't1', sub: 'u1' } },
                { plan: 'STARTER', billingCycle: 'MONTHLY' },
            ),
        /Plan-Wechsel im Onboarding blockiert/,
    );
});

test('onboarding throws NotFoundException without a subscription', async () => {
    const ctrl = buildController({
        subscriptionUsage: { findForTenant: async () => null },
    });

    await assert.rejects(
        () =>
            ctrl.completeOnboardingSubscription(
                { user: { tenantId: 't404', sub: 'u1' } },
                { plan: 'SPORT', billingCycle: 'YEARLY' },
            ),
        /Keine Subscription/,
    );
});

test('onboarding writes an audit log with COMPLETE_ONBOARDING_SUBSCRIPTION', async () => {
    const audit = buildAudit();
    const ctrl = buildController({ auditService: audit });

    await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1', email: 'admin@verein.de' } },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    assert.equal(audit.calls.length, 1);
    const [call] = audit.calls;
    assert.equal(call.action, 'COMPLETE_ONBOARDING_SUBSCRIPTION');
    assert.equal(call.entity, 'Subscription');
    assert.equal(call.entityId, 't1');
    assert.equal(call.actor.userId, 'u1');
    assert.equal(call.actor.email, 'admin@verein.de');
    assert.equal(call.actor.source, 'web');
    assert.equal(call.changes.plan, 'SPORT');
    assert.equal(call.changes.promoRedeemed, false);
});

test('onboarding without AdminAuditService writes no audit log (silent)', async () => {
    const ctrl = buildController({ auditService: null });

    // Must not throw — audit log is optional
    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    assert.equal(result.plan, 'SPORT');
});

test('onboarding falls back to email "unknown" when req.user.email is missing', async () => {
    const audit = buildAudit();
    const ctrl = buildController({ auditService: audit });

    await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } }, // NO email
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].actor.email, 'unknown');
});

test('onboarding uses customEmailResolver when injected', async () => {
    const audit = buildAudit();
    const ctrl = buildController({
        auditService: audit,
        userEmailResolver: (req) => `${req.user?.sub}@override.test`,
    });

    await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1', email: 'real@verein.de' } },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    // Custom resolver takes precedence over req.user.email
    assert.equal(audit.calls[0].actor.email, 'u1@override.test');
});

test('onboarding uses the x-session-id header as audit context', async () => {
    const audit = buildAudit();
    const ctrl = buildController({ auditService: audit });

    await ctrl.completeOnboardingSubscription(
        {
            user: { tenantId: 't1', sub: 'u1' },
            headers: { 'x-session-id': 'sess-42' },
        },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    assert.equal(audit.calls[0].actor.context, 'sess-42');
});

test('atomic path: applyOnboardingSelection is used, sequential calls are avoided', async () => {
    let appliedCalls = 0;
    let changePlanCalls = 0;
    const atomicWrite = {
        async applyOnboardingSelection(tenantId, input, redeemCb) {
            appliedCalls++;
            // In the atomic path the adapter MUST call the promo callback itself
            const promoRedemption = redeemCb
                ? await redeemCb(
                      {
                          /* stub-tx */
                      },
                      'sub-1',
                  )
                : null;
            return {
                plan: input.planId,
                billingCycle: input.cycle,
                subscriptionId: 'sub-1',
                promoRedemption,
            };
        },
        async changePlanImmediate() {
            changePlanCalls++;
            return { plan: 'unused', billingCycle: 'unused' };
        },
        async schedulePlanChange() {},
        async acceptPendingPlanVersion() {},
        async cancelSubscription() {
            return { canceledAt: null, status: 'ACTIVE' };
        },
    };
    const ctrl = buildController({ subscriptionWrite: atomicWrite });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    assert.equal(appliedCalls, 1, 'the atomic path must be called');
    assert.equal(
        changePlanCalls,
        0,
        'sequential changePlanImmediate must NOT run additionally',
    );
    assert.equal(result.plan, 'SPORT');
});

test('atomic path: adapter error throws BadRequestException (no half-state)', async () => {
    const failingAtomic = {
        async applyOnboardingSelection() {
            throw new Error('plan-update collision in tx');
        },
        async changePlanImmediate() {
            throw new Error('legacy path must NOT be hit');
        },
        async schedulePlanChange() {},
        async acceptPendingPlanVersion() {},
        async cancelSubscription() {
            return { canceledAt: null, status: 'ACTIVE' };
        },
    };
    const ctrl = buildController({ subscriptionWrite: failingAtomic });

    await assert.rejects(
        () =>
            ctrl.completeOnboardingSubscription(
                { user: { tenantId: 't1', sub: 'u1' } },
                { plan: 'SPORT', billingCycle: 'YEARLY' },
            ),
        /Onboarding-Anlage fehlgeschlagen/,
    );
});

test('atomic path: promo-redeem callback is called with subscriptionId', async () => {
    let calledWithSubId = null;
    const atomicWrite = {
        async applyOnboardingSelection(tenantId, input, redeemCb) {
            const promoRedemption = redeemCb ? await redeemCb({}, 'sub-from-tx-42') : null;
            return {
                plan: input.planId,
                billingCycle: input.cycle,
                subscriptionId: 'sub-from-tx-42',
                promoRedemption,
            };
        },
        async changePlanImmediate() {
            return { plan: '', billingCycle: '' };
        },
        async schedulePlanChange() {},
        async acceptPendingPlanVersion() {},
        async cancelSubscription() {
            return { canceledAt: null, status: 'ACTIVE' };
        },
    };
    const promo = {
        async redeemInTransaction(input, _tx) {
            calledWithSubId = input.subscriptionId;
            return {
                id: 'red-1',
                promoCodeId: 'p1',
                subscriptionId: input.subscriptionId,
                tenantId: input.tenantId,
                appliedValueType: 'PERCENT',
                appliedValue: '20',
                appliedDurationType: 'ONCE',
                appliedDurationValue: null,
                startsAt: new Date('2026-05-10T00:00:00Z'),
                endsAt: null,
                status: 'ACTIVE',
                redeemedAt: new Date(),
                reversedAt: null,
            };
        },
        async redeem() {
            throw new Error('atomic path must use redeemInTransaction, not redeem');
        },
    };
    const ctrl = buildController({ subscriptionWrite: atomicWrite, promoCodes: promo });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY', promoCode: 'EINSTEIGER20' },
    );

    assert.equal(calledWithSubId, 'sub-from-tx-42');
    assert.equal(result.promoRedemption?.code, 'EINSTEIGER20');
});

test('fallback path kicks in when the adapter does NOT implement applyOnboardingSelection', async () => {
    // buildWritePort() provides NO applyOnboardingSelection — the fallback path must become active
    const write = buildWritePort();
    const ctrl = buildController({ subscriptionWrite: write });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    assert.equal(write.changePlanCalls.length, 1, 'sequential changePlanImmediate must run');
    assert.equal(result.plan, 'SPORT');
});

test('onboarding catches audit failures (write path stays green)', async () => {
    const failingAudit = {
        async log() {
            throw new Error('audit-port unreachable');
        },
    };
    const ctrl = buildController({ auditService: failingAudit });

    // Must not throw — audit failure is swallowed
    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        { plan: 'SPORT', billingCycle: 'YEARLY' },
    );

    assert.equal(result.plan, 'SPORT');
});

// ─── P11.7.3: Bundle booking in onboarding ──────────────────────────────

function buildSubscriptionBundlesStub({ failOn = null } = {}) {
    return {
        addCalls: [],
        async addBundleToSubscription(input) {
            this.addCalls.push(input);
            if (failOn && input.bundleVersionId === failOn) {
                const err = new Error(`Bundle '${failOn}' inkompatibel`);
                err.response = { code: 'BUNDLE_INCOMPATIBLE_WITH_PLAN' };
                throw err;
            }
            return {
                id: `sub-bundle-${this.addCalls.length}`,
                subscriptionId: input.subscriptionId,
                bundleVersionId: input.bundleVersionId,
                startedAt: new Date(),
                minimumTermEndsAt: null,
                canceledAt: null,
                canceledEffectiveAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
        },
    };
}

test('onboarding: bundleVersionIds are booked best-effort (bundlesAdded counts)', async () => {
    const bundles = buildSubscriptionBundlesStub();
    const ctrl = buildController({ subscriptionBundles: bundles });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        {
            plan: 'SPORT',
            billingCycle: 'YEARLY',
            bundleVersionIds: ['11111111-2222-3333-4444-555555555555'],
        },
    );
    assert.equal(result.bundlesAdded, 1);
    assert.equal(result.warnings.length, 0);
    assert.equal(bundles.addCalls[0].currentPlanKey, 'SPORT');
});

test('onboarding: a failed bundle booking lands as a warning, plan stays persisted', async () => {
    const FAIL_ID = '00000000-bad0-0000-0000-000000000000';
    const OK_ID = '99999999-aaaa-bbbb-cccc-dddddddddddd';
    const bundles = buildSubscriptionBundlesStub({ failOn: FAIL_ID });
    const ctrl = buildController({ subscriptionBundles: bundles });

    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        {
            plan: 'SPORT',
            billingCycle: 'YEARLY',
            bundleVersionIds: [OK_ID, FAIL_ID],
        },
    );
    assert.equal(result.bundlesAdded, 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /inkompatibel/);
    // Plan set anyway
    assert.equal(result.plan, 'SPORT');
});

test('onboarding: bundleVersionIds without a registered module → warning, no crash', async () => {
    // No subscriptionBundles service injected
    const ctrl = buildController();
    const result = await ctrl.completeOnboardingSubscription(
        { user: { tenantId: 't1', sub: 'u1' } },
        {
            plan: 'SPORT',
            billingCycle: 'YEARLY',
            bundleVersionIds: ['11111111-2222-3333-4444-555555555555'],
        },
    );
    assert.equal(result.bundlesAdded, 0);
    assert.match(result.warnings[0], /SubscriptionBundleModule ist nicht/);
});

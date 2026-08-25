import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PendingPlanMaterializationService,
    TenantBillingController,
    decideCancellationFor,
    decideRenewal,
} from '../dist/billing/index.js';

// The cases a tenant can actually reach, rather than the ones a rule was
// written for.
//
// Two of them are states nobody designs for and everybody ends up in: a payment
// that failed, and an enterprise deal still sitting with sales. A tenant in
// arrears wanting out is the single most important cancellation there is, and a
// status check placed one line too early would refuse it. Nothing in this
// repository refuses it today — this suite is what keeps that true.
//
// The rest are the combinations. A cancellation and a scheduled change landing
// on the SAME day is the ordinary shape, not an exotic one: both are usually
// pinned to the term end. And whatever else is pending — a plan, a plan version
// — a subscription that has ended accepts none of it.

const DAY = 86_400_000;
const TERM_END = new Date(Date.now() + 20 * DAY);

const cancellable = (overrides = {}) => ({
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    currentPeriodEnd: TERM_END,
    minimumTermUntil: TERM_END,
    trialEndsAt: null,
    ...overrides,
});

describe('a tenant whose payment failed', () => {
    test('can still cancel, and lands at the same date as anybody else', () => {
        // The one cancellation that must never be refused. Somebody in arrears
        // wants out; making them settle an invoice first to be allowed to leave
        // is how a billing dispute becomes a complaint.
        const inArrears = decideCancellationFor(cancellable({ status: 'PAST_DUE' }), new Date(), 0);
        const ordinary = decideCancellationFor(cancellable(), new Date(), 0);

        assert.deepEqual(inArrears.effectiveAt, ordinary.effectiveAt);
        assert.deepEqual(inArrears.effectiveAt, TERM_END);
    });
});

describe('a tenant still waiting on sales', () => {
    test('cancels immediately, because nothing was ever committed', () => {
        // PENDING_SALES has no period and no term: there is nothing to run out.
        const now = new Date();
        const decision = decideCancellationFor(
            cancellable({
                status: 'PENDING_SALES',
                currentPeriodEnd: null,
                minimumTermUntil: null,
            }),
            now,
            14,
        );

        assert.deepEqual(decision.effectiveAt, now);
        assert.equal(decision.afterNoticeDeadline, false, 'a notice window it never had');
    });

    test('and one that did get a period keeps it', () => {
        // The premise: the immediate answer comes from the absent dates, not
        // from the status.
        const decision = decideCancellationFor(
            cancellable({ status: 'PENDING_SALES' }),
            new Date(),
            0,
        );

        assert.deepEqual(decision.effectiveAt, TERM_END);
    });
});

describe('a change and a cancellation on the same day', () => {
    // The ordinary shape: a downgrade scheduled for the term end, then a
    // cancellation, which also lands at the term end. Both are due in the same
    // cron run, and the question is which one the tenant wakes up to.
    const SAME_MOMENT = new Date('2027-01-01T00:00:00.000Z');

    function materialize(now) {
        const applied = [];
        const service = new PendingPlanMaterializationService(
            {
                findDuePendingPlanChanges: async () => [
                    {
                        tenantId: 't1',
                        pendingPlan: 'STARTER',
                        pendingBillingCycle: 'MONTHLY',
                        canceledAt: new Date('2026-06-01'),
                        canceledEffectiveAt: SAME_MOMENT,
                    },
                ],
            },
            {
                async changePlanImmediate(tenantId, input) {
                    applied.push(input);
                    return { plan: input.planId, billingCycle: input.cycle, claimed: true };
                },
            },
            { computeLimits: async () => ({}), invalidateTenant() {} },
        );
        return service.materializeDuePlanChanges(now).then((r) => ({ ...r, applied }));
    }

    test('the ending wins, exactly at the moment they meet', async () => {
        const { applied } = await materialize(SAME_MOMENT);

        assert.equal(applied.length, 0, 'the plan of an ended subscription was rewritten');
    });

    test('and a minute earlier the change still happens', async () => {
        // The premise: the boundary is the moment, not the day.
        const { applied } = await materialize(new Date(SAME_MOMENT.getTime() - 60_000));

        assert.equal(applied.length, 1);
    });
});

describe('a plan version published before the customer left', () => {
    const version = (overrides = {}) => ({
        pendingPlanVersionId: 'pv2',
        pendingPlanVersionEffectiveAt: new Date('2027-01-01'),
        pendingPlanVersionAccepted: true,
        pendingPlanVersionNonRegressive: true,
        canceledAt: null,
        canceledEffectiveAt: null,
        ...overrides,
    });

    test('does not roll onto a subscription whose term is over', () => {
        const decision = decideRenewal(
            version({
                canceledAt: new Date('2026-06-01'),
                canceledEffectiveAt: new Date('2027-01-01'),
            }),
            new Date('2027-01-02'),
        );

        assert.equal(decision, 'SKIP');
    });

    test('while a cancellation still to come stops nothing', () => {
        // The premise, and the half every rule about "cancelled" gets wrong.
        const decision = decideRenewal(
            version({
                canceledAt: new Date('2026-12-01'),
                canceledEffectiveAt: new Date('2028-01-01'),
            }),
            new Date('2027-01-02'),
        );

        assert.equal(decision, 'ROLL_FORWARD');
    });

    test('and an uncancelled subscription rolls as before', () => {
        assert.equal(decideRenewal(version(), new Date('2027-01-02')), 'ROLL_FORWARD');
    });
});

describe('accepting a version after the subscription ended', () => {
    const ENDED = {
        plan: 'STARTER',
        billingCycle: 'YEARLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: new Date('2026-01-01'),
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date(Date.now() - 60 * DAY),
        minimumTermUntil: null,
        canceledAt: new Date(Date.now() - 90 * DAY),
        canceledEffectiveAt: new Date(Date.now() - 60 * DAY),
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: null,
        pendingPlanVersion: { id: 'pv2', planId: 'STARTER', version: 2 },
        pendingPlanVersionEffectiveAt: new Date(Date.now() - 30 * DAY),
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
    };

    function controller(subscription) {
        const port = {
            accepted: [],
            async acceptPendingPlanVersion(tenantId, userId) {
                this.accepted.push({ tenantId, userId });
                return { acceptedAt: new Date(), effectiveAt: null, alreadyAccepted: false };
            },
        };
        return {
            port,
            api: new TenantBillingController(
                {
                    computeLimits: async () => ({
                        plan: 'STARTER',
                        quotas: {},
                        features: new Set(),
                    }),
                    invalidateTenant() {},
                },
                {
                    async preview() {
                        return { isImmediate: false, effectiveAt: null, blockers: [] };
                    },
                },
                { findForTenant: async () => subscription },
                { snapshot: async () => ({}) },
                port,
                () => 't1',
                () => 'u1',
            ),
        };
    }

    const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

    test('is refused rather than recorded against a dead contract', async () => {
        const { api, port } = controller(ENDED);

        await assert.rejects(
            api.acceptPendingPlanVersion(request),
            (err) => err.getResponse?.().code === 'SUBSCRIPTION_ENDED',
        );
        assert.equal(port.accepted.length, 0);
    });

    test('while a running subscription accepts as before', async () => {
        const { api, port } = controller({
            ...ENDED,
            canceledAt: null,
            canceledEffectiveAt: null,
        });

        await api.acceptPendingPlanVersion(request);

        assert.equal(port.accepted.length, 1);
    });
});

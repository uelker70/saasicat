import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PendingPlanMaterializationService,
    TenantBillingController,
    decideCancellationFor,
    decideRenewal,
} from '../dist/billing/index.js';
import {
    FLAT_ENTITLEMENTS,
    REQUEST,
    recordingWritePort,
    usageRecord,
} from './helpers/subscription-fixtures.js';

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

// @requirement SC-SUB-009 — A tenant in arrears can still cancel
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

// @requirement SC-CANC-004 — Where nothing is left to run, the cancellation lands now, never in the past
// @requirement SC-SPEC-009 — A subscription waiting on a negotiated contract falls back to a named interim plan
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

// @requirement SC-CHG-014 — Nothing starts after the end, and nothing sells a period the end cuts short
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

// @requirement SC-SUB-012 — A new version of a plan does not move a customer who already bought one
// @requirement SC-SUB-013 — Nothing rolls forward onto a subscription whose cancellation has landed
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

/** A subscription whose cancellation landed two months ago. */
const ENDED = usageRecord({
    currentPeriodEnd: new Date(Date.now() - 60 * DAY),
    canceledAt: new Date(Date.now() - 90 * DAY),
    canceledEffectiveAt: new Date(Date.now() - 60 * DAY),
});

const STILL_RUNNING = usageRecord({
    currentPeriodEnd: new Date(Date.now() + 30 * DAY),
});

/** The tenant billing routes over one subscription and one recording port. */
function routes(subscription) {
    const port = recordingWritePort();
    return {
        port,
        api: new TenantBillingController(
            FLAT_ENTITLEMENTS,
            {
                async preview() {
                    return { isImmediate: false, effectiveAt: null, blockers: [] };
                },
                async assertChangeAllowed() {
                    return [];
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

// @requirement SC-SUB-011 — A subscription with nothing left to run is recorded as ended
// @requirement SC-SUB-010 — A subscription that has ended can no longer change plan
describe('activating a subscription that has already ended', () => {
    // Onboarding is a first activation, and a contract that is over is not one.
    // Its own guard rather than the plan route's: they are two routes, and only
    // one of them had been checked — so the preferred, atomic path was the one
    // where a cancelled subscription could still have its plan and period
    // rewritten while its entitlements stayed empty.
    const activate = (api) =>
        api.completeOnboardingSubscription(REQUEST, { plan: 'STARTER', billingCycle: 'YEARLY' });

    test('is refused on the atomic path, which is the preferred one', async () => {
        const { api, port } = routes(ENDED);

        await assert.rejects(
            activate(api),
            (err) => err.getResponse?.().code === 'SUBSCRIPTION_ENDED',
        );
        assert.equal(port.atomic.length, 0, 'an ended subscription was activated');
    });

    test('while a running subscription is activated as before', async () => {
        // The premise: the refusal is about the ending, not about onboarding.
        const { api, port } = routes(STILL_RUNNING);

        await activate(api);

        assert.equal(port.atomic.length, 1);
    });

    test('and the write carries what the route read, so a late cancellation wins', async () => {
        // The claim, not the check: a cancellation declared between the read
        // above and this write takes the row, and the caller is told.
        const { api, port } = routes(STILL_RUNNING);

        await activate(api);

        assert.equal(port.atomic[0].expectedCanceledAt, null);
    });
});

// @requirement SC-SUB-014 — Accepting the same pending version twice changes nothing
// @requirement SC-SUB-015 — A scheduled change that comes due after the customer has left is declined and recorded
describe('accepting a version after the subscription ended', () => {
    const withPendingVersion = (base) =>
        usageRecord({
            ...base,
            pendingPlanVersion: { id: 'pv2', planId: 'STARTER', version: 2 },
            pendingPlanVersionEffectiveAt: new Date(Date.now() - 30 * DAY),
        });

    test('is refused rather than recorded against a dead contract', async () => {
        const { api, port } = routes(withPendingVersion(ENDED));

        await assert.rejects(
            api.acceptPendingPlanVersion(REQUEST),
            (err) => err.getResponse?.().code === 'SUBSCRIPTION_ENDED',
        );
        assert.equal(port.accepted.length, 0);
    });

    test('while a running subscription accepts as before', async () => {
        const { api, port } = routes(withPendingVersion(STILL_RUNNING));

        await api.acceptPendingPlanVersion(REQUEST);

        assert.equal(port.accepted.length, 1);
    });
});

// @requirement SC-ENTL-015 — The end of a subscription is seen on every enforcement path
// @requirement SC-CANC-018 — The agreed contract ends when the subscription does, not when the customer declares
describe('what else ends when the subscription does', () => {
    // The boundary is not a fact about one table. Everything a tenant was sold
    // hangs off the subscription, and each of those had its own answer to
    // "is this customer still under contract" until they were asked to agree.

    test('the frozen contract is ended on the same date', async () => {
        // A contract is the agreed service, frozen at a plan change. Left
        // active it outlives the subscription that agreed to it, and the
        // invoice side goes on reading a live agreement while entitlement
        // resolution grants nothing — the answer that bills says yes.
        const ended = [];
        const port = recordingWritePort();
        const api = new TenantBillingController(
            FLAT_ENTITLEMENTS,
            {
                async preview() {
                    return { isImmediate: false, effectiveAt: null, blockers: [] };
                },
            },
            {
                findForTenant: async () =>
                    usageRecord({
                        currentPeriodEnd: new Date(Date.now() + 20 * DAY),
                        minimumTermUntil: new Date(Date.now() + 20 * DAY),
                    }),
            },
            { snapshot: async () => ({}) },
            port,
            () => 't1',
            () => 'u1',
            null, // blockedPlans
            null, // promoCodes
            null, // auditService
            null, // userEmailResolver
            null, // auditContextResolver
            null, // subscriptionBundles
            {
                async freezeOnPlanChange() {},
                async endOnCancellation(tenantId, effectiveAt) {
                    ended.push({ tenantId, effectiveAt });
                },
            },
        );

        const result = await api.cancelSubscription(REQUEST, {});

        assert.equal(ended.length, 1, 'the contract outlived the subscription');
        assert.deepEqual(ended[0].effectiveAt, result.canceledEffectiveAt);
    });

    test('and a cancellation already recorded repairs its contract too', async () => {
        // Two ways to arrive with a stored cancellation and an open contract: a
        // row written before this hook existed, and a retry after the
        // subscription write succeeded while the non-fatal contract call did
        // not. Only the request that WINS the write reaches the hook on the
        // fresh path, so a second attempt has to repair it or nothing ever
        // will — and the route would go on reporting the cancellation as
        // handled.
        const ended = [];
        const alreadyCanceledAt = new Date(Date.now() + 20 * DAY);
        const api = new TenantBillingController(
            FLAT_ENTITLEMENTS,
            {
                async preview() {
                    return { isImmediate: false, effectiveAt: null, blockers: [] };
                },
            },
            {
                findForTenant: async () =>
                    usageRecord({
                        currentPeriodEnd: alreadyCanceledAt,
                        canceledAt: new Date(),
                        canceledEffectiveAt: alreadyCanceledAt,
                    }),
            },
            { snapshot: async () => ({}) },
            recordingWritePort(),
            () => 't1',
            () => 'u1',
            null,
            null,
            null,
            null,
            null,
            null,
            {
                async freezeOnPlanChange() {},
                async endOnCancellation(tenantId, effectiveAt) {
                    ended.push(effectiveAt);
                },
            },
        );

        const result = await api.cancelSubscription(REQUEST, {});

        assert.equal(result.alreadyCanceled, true);
        assert.deepEqual(ended, [alreadyCanceledAt], 'the repeat left the contract open');
    });

    test('and a consumer without contracts is unaffected', async () => {
        // The premise: the port is optional, and its absence is not an error.
        const port = recordingWritePort();
        const api = new TenantBillingController(
            FLAT_ENTITLEMENTS,
            {
                async preview() {
                    return { isImmediate: false, effectiveAt: null, blockers: [] };
                },
            },
            {
                findForTenant: async () =>
                    usageRecord({ currentPeriodEnd: new Date(Date.now() + 20 * DAY) }),
            },
            { snapshot: async () => ({}) },
            port,
            () => 't1',
            () => 'u1',
        );

        const result = await api.cancelSubscription(REQUEST, {});

        assert.equal(result.alreadyCanceled, false);
    });
});

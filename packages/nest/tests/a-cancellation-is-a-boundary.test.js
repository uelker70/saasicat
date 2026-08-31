import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    PendingPlanMaterializationService,
    PlanChangePreviewService,
    TenantBillingController,
} from '../dist/billing/index.js';

// A cancellation is a boundary, and two writes used to cross it.
//
// A plan change and a cancellation are two decisions about one subscription,
// and neither could see the other: the route read no cancellation date, and the
// record the materialisation service is handed did not carry one. The result
// was not a wrong date but a wrong contract. An upgrade on a subscription that
// had already ended was applied and prorated — charged for — while entitlement
// resolution, which does read the cancellation, granted nothing. And a change
// scheduled before the customer cancelled came due afterwards and restarted the
// billing period on a term that was over.
//
// The rule is one sentence: nothing may start after the end, and nothing may
// sell a period the end cuts short. A cancellation that has NOT landed declines
// nothing — a customer who bought a further period by cancelling late may still
// choose the plan they spend it on.

const DAY = 86_400_000;

const SUBSCRIPTION = {
    plan: 'STARTER',
    billingCycle: 'YEARLY',
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: new Date('2026-01-01'),
    currentPeriodStart: new Date('2026-01-01'),
    currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    minimumTermUntil: new Date(Date.now() + 30 * DAY),
    canceledAt: null,
    canceledEffectiveAt: null,
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: null,
    pendingPlanVersion: null,
    pendingPlanVersionEffectiveAt: null,
    pendingPlanVersionAccepted: false,
    pendingPlanVersionAcceptedAt: null,
};

/**
 * A store that answers the conditional claim.
 *
 * `canceledAtInStore` is what the row holds NOW. Left out, the store agrees
 * with whatever the caller read — the ordinary case, where nothing happened in
 * between. Given a value, it disagrees, which is the race.
 */
function writePort({ canceledAtInStore } = {}) {
    return {
        immediate: [],
        scheduled: [],
        canceledAtInStore,
        claims(input) {
            if (canceledAtInStore === undefined) return true;
            const stored = canceledAtInStore?.getTime() ?? null;
            const expected = input.expectedCanceledAt?.getTime() ?? null;
            return stored === expected;
        },
        async changePlanImmediate(tenantId, input) {
            if (!this.claims(input)) {
                return { plan: 'STARTER', billingCycle: 'YEARLY', claimed: false };
            }
            this.immediate.push(input);
            return { plan: input.planId, billingCycle: input.cycle, claimed: true };
        },
        async schedulePlanChange(tenantId, input) {
            if (!this.claims(input)) return { claimed: false };
            this.scheduled.push(input);
            return { claimed: true };
        },
        cancelClaims: [],
        /** A store that lets exactly one declaration claim the row. */
        async cancelSubscription(tenantId, input) {
            const lost = this.cancelClaims.length > 0;
            const first = lost ? this.cancelClaims[0] : input;
            this.cancelClaims.push(input);
            return {
                canceledAt: first.canceledAt,
                canceledEffectiveAt: first.effectiveAt,
                status: 'ACTIVE',
                alreadyCanceled: lost,
            };
        },
    };
}

function buildController(subscription, port, preview) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        {
            async preview() {
                return preview;
            },
        },
        { findForTenant: async () => subscription },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
    );
}

const IMMEDIATE_UPGRADE = { isImmediate: true, effectiveAt: null, blockers: [] };
const request = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };
const changeTo = (controller) =>
    controller.changePlan(request, { plan: 'STANDARD', billingCycle: 'YEARLY' });

// @requirement SC-SUB-013 — Nothing rolls forward onto a subscription whose cancellation has landed
// @requirement SC-CHG-014 — Nothing starts after the end, and nothing sells a period the end cuts short
describe('a subscription that has ended', () => {
    const ended = {
        ...SUBSCRIPTION,
        canceledAt: new Date(Date.now() - 90 * DAY),
        canceledEffectiveAt: new Date(Date.now() - 60 * DAY),
    };

    test('refuses a plan change instead of charging for one', async () => {
        // The upgrade would have been prorated and billed, while entitlement
        // resolution granted nothing — it reads the same cancellation.
        const port = writePort();

        await assert.rejects(
            changeTo(buildController(ended, port, IMMEDIATE_UPGRADE)),
            (err) => err.getResponse?.().code === 'SUBSCRIPTION_ENDED',
        );
        assert.equal(port.immediate.length, 0, 'the plan was changed anyway');
    });

    test('while a running one still changes plans', async () => {
        // The premise: the refusal is about the end, not about plan changes.
        const port = writePort();

        await changeTo(buildController(SUBSCRIPTION, port, IMMEDIATE_UPGRADE));

        assert.equal(port.immediate.length, 1);
    });
});

// @requirement SC-ENTL-013 — A cancellation that is merely declared changes nothing
// @requirement SC-CHG-014 — Nothing starts after the end, and nothing sells a period the end cuts short
describe('a cancellation still to come', () => {
    const ending = {
        ...SUBSCRIPTION,
        canceledAt: new Date(),
        canceledEffectiveAt: new Date(Date.now() + 30 * DAY),
    };

    test('lets the plan change, and does not sell a term it cuts short', async () => {
        // A fresh window is a fresh term. The subscription ends on a date this
        // change does not move, so opening one sells a year the customer loses
        // eleven months into.
        const port = writePort();

        await changeTo(buildController(ending, port, IMMEDIATE_UPGRADE));

        assert.equal(port.immediate.length, 1, 'the change was refused');
        assert.equal(port.immediate[0].periodStart, null);
        assert.equal(port.immediate[0].periodEnd, null);
    });

    test('while an uncancelled subscription does get a fresh term', async () => {
        // The premise: without a cancellation the immediate branch still opens
        // the window it is there to open.
        const port = writePort();

        await changeTo(buildController(SUBSCRIPTION, port, IMMEDIATE_UPGRADE));

        assert.notEqual(port.immediate[0].periodStart, null);
        assert.notEqual(port.immediate[0].periodEnd, null);
    });
});

// @requirement SC-CHG-015 — A cancelled subscription cannot change its billing rhythm
describe('a cycle change while a cancellation is outstanding', () => {
    /**
     * The preview over a monthly subscription that is cancelled but running.
     * The setup is identical for both tests below; what differs is the cycle
     * they ask for, which is the whole subject.
     */
    function previewFor(targetCycle) {
        const service = new PlanChangePreviewService(
            CATALOG,
            {
                computeLimits: async () => ({
                    plan: 'STARTER',
                    quotas: { users: 3 },
                    features: new Set(['CORE']),
                }),
                invalidateTenant() {},
            },
            { findForTenant: async () => ending },
            { snapshot: async () => ({ users: 1 }) },
            null,
        );
        return service.preview('t1', 'STANDARD', targetCycle, new Date());
    }

    test('the preview says so before the reader has decided anything', async () => {
        // A blocker is what the wizard reads. Without one the reader picks the
        // cycle, reads the consequence, ticks the acknowledgement and meets the
        // refusal on confirm — the whole flow spent on an answer that was known
        // at the first step.
        const dto = await previewFor('YEARLY');

        assert.ok(
            dto.blockers.some((b) => b.code === 'CANCELLATION_LOCKS_THE_CYCLE'),
            `no blocker among ${JSON.stringify(dto.blockers.map((b) => b.code))}`,
        );
    });

    test('and an ended subscription is refused outright, not merely locked', async () => {
        // Two different refusals, and the wider one has to be said too: an
        // ended subscription refuses EVERY plan change. Reporting only the
        // cycle lock let a same-cycle upgrade be previewed as an ordinary
        // immediate change and rejected on submit.
        const service = new PlanChangePreviewService(
            CATALOG,
            {
                computeLimits: async () => ({
                    plan: 'STARTER',
                    quotas: { users: 3 },
                    features: new Set(['CORE']),
                }),
                invalidateTenant() {},
            },
            {
                findForTenant: async () => ({
                    ...SUBSCRIPTION,
                    billingCycle: 'MONTHLY',
                    canceledAt: new Date(Date.now() - 90 * DAY),
                    canceledEffectiveAt: new Date(Date.now() - 60 * DAY),
                }),
            },
            { snapshot: async () => ({ users: 1 }) },
            null,
        );

        const dto = await service.preview('t1', 'STANDARD', 'MONTHLY', new Date());

        assert.ok(
            dto.blockers.some((b) => b.code === 'SUBSCRIPTION_ENDED'),
            `no blocker among ${JSON.stringify(dto.blockers.map((b) => b.code))}`,
        );
    });

    test('and says nothing when the cycle stays', async () => {
        // The premise: the blocker is about the rhythm, not about being
        // cancelled. A plan change on the same cycle is allowed and must not be
        // reported as impossible.
        const dto = await previewFor('MONTHLY');

        assert.deepEqual(
            dto.blockers.filter((b) => b.code === 'CANCELLATION_LOCKS_THE_CYCLE'),
            [],
        );
    });

    const ending = {
        ...SUBSCRIPTION,
        billingCycle: 'MONTHLY',
        canceledAt: new Date(),
        canceledEffectiveAt: new Date(Date.now() + 20 * DAY),
    };

    test('is refused, because the ending was calculated in the old rhythm', async () => {
        // Monthly, ending on the 20th, upgraded to a yearly plan: the plan goes
        // up and the cycle gets longer, so it is an immediate change. The write
        // would put YEARLY beside a monthly period that the cancellation closes
        // in twenty days, and the preview prorates a year across them.
        const port = writePort();

        await assert.rejects(
            buildController(ending, port, IMMEDIATE_UPGRADE).changePlan(request, {
                plan: 'STANDARD',
                billingCycle: 'YEARLY',
            }),
            (err) => err.getResponse?.().code === 'CANCELLATION_LOCKS_THE_CYCLE',
        );
        assert.equal(port.immediate.length, 0);
    });

    test('while the plan still moves on the cycle it was sold in', async () => {
        // The premise: what is locked is the rhythm, not the plan.
        const port = writePort();

        await buildController(ending, port, IMMEDIATE_UPGRADE).changePlan(request, {
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
        });

        assert.equal(port.immediate.length, 1);
        assert.equal(port.immediate[0].periodEnd, null, 'a fresh term was opened anyway');
    });

    test('and an uncancelled subscription may change cycle freely', async () => {
        const port = writePort();

        await buildController(
            { ...SUBSCRIPTION, billingCycle: 'MONTHLY' },
            port,
            IMMEDIATE_UPGRADE,
        ).changePlan(request, { plan: 'STANDARD', billingCycle: 'YEARLY' });

        assert.equal(port.immediate.length, 1);
        assert.notEqual(port.immediate[0].periodEnd, null);
    });
});

// @requirement SC-CHG-011 — A decision taken against one state is not written into another
describe('a cancellation arriving while a plan change is being decided', () => {
    // The route reads the subscription, computes a preview, decides three
    // things from the cancellation — whether to refuse, whether the cycle may
    // move, whether to open a fresh period — and only then writes. A
    // cancellation declared in that window makes all three answers about a
    // state that no longer exists, and an unconditional write would record a
    // plan term running past the date the subscription ends.

    test('the immediate change is refused rather than written over it', async () => {
        // Read: no cancellation. Store: cancelled a moment ago.
        const port = writePort({ canceledAtInStore: new Date() });

        await assert.rejects(
            changeTo(buildController(SUBSCRIPTION, port, IMMEDIATE_UPGRADE)),
            (err) => err.getResponse?.().code === 'SUBSCRIPTION_CHANGED',
        );
        assert.equal(port.immediate.length, 0);
    });

    test('and so is the scheduled one', async () => {
        const port = writePort({ canceledAtInStore: new Date() });
        const deferred = { isImmediate: false, effectiveAt: new Date(), blockers: [] };

        await assert.rejects(
            changeTo(buildController(SUBSCRIPTION, port, deferred)),
            (err) => err.getResponse?.().code === 'SUBSCRIPTION_CHANGED',
        );
        assert.equal(port.scheduled.length, 0);
    });

    test('while an unchanged subscription is written as decided', async () => {
        // The premise: the claim compares a value, it does not refuse on
        // principle. Read and store agree here, as they do in every ordinary
        // request.
        const port = writePort();

        await changeTo(buildController(SUBSCRIPTION, port, IMMEDIATE_UPGRADE));

        assert.equal(port.immediate.length, 1);
        assert.equal(port.immediate[0].expectedCanceledAt, null);
    });
});

// @requirement SC-CHG-011 — A decision taken against one state is not written into another
describe('a boundary that passes while the request is being decided', () => {
    // The landed check runs when the subscription is read; the preview runs
    // after it, and can take a while. A cancellation recorded BEFORE the
    // request and landing during it satisfies the claim — `canceledAt` does not
    // change when time passes — so the plan of an ended subscription would be
    // changed and audited.
    test('is refused rather than written a moment late', async () => {
        const port = writePort();
        // Still ahead when the route reads the subscription, past by the time
        // the preview answers. The preview is where the time goes, so the fake
        // spends it — without that, the check at the top of the route catches
        // this and the re-read below is never exercised.
        const landingShortly = new Date(Date.now() + 40);
        const slowPreview = {
            async preview() {
                await new Promise((resume) => setTimeout(resume, 80));
                return IMMEDIATE_UPGRADE;
            },
        };
        const controller = new TenantBillingController(
            {
                computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
                invalidateTenant() {},
            },
            slowPreview,
            {
                findForTenant: async () => ({
                    ...SUBSCRIPTION,
                    canceledAt: new Date(Date.now() - 30 * DAY),
                    canceledEffectiveAt: landingShortly,
                }),
            },
            { snapshot: async () => ({}) },
            port,
            () => 't1',
            () => 'u1',
        );

        await assert.rejects(
            changeTo(controller),
            (err) => err.getResponse?.().code === 'SUBSCRIPTION_ENDED',
        );
        assert.equal(port.immediate.length, 0);
    });
});

// @requirement SC-CANC-013 — Two cancellations arriving at once produce one
describe('two declarations arriving at once', () => {
    // The route checks, then writes, and those are two moments. Straddling a
    // notice deadline the second declaration recomputes against a later `now`
    // and lands a whole billing cycle further out — so the store settles it,
    // and the loser reads back what the winner wrote.
    test('the second one reports the first one rather than replacing it', async () => {
        const port = writePort();
        const controller = buildController(SUBSCRIPTION, port, IMMEDIATE_UPGRADE);

        const first = await controller.cancelSubscription(request, {});
        const second = await controller.cancelSubscription(request, {});

        assert.equal(first.alreadyCanceled, false);
        assert.equal(second.alreadyCanceled, true);
        assert.deepEqual(second.canceledEffectiveAt, first.canceledEffectiveAt);
        // Nothing it cannot know, exactly as on a retry.
        assert.equal(second.termEndsAt, null);
        assert.equal(second.afterNoticeDeadline, null);
    });
});

// @requirement SC-CHG-014 — Nothing starts after the end, and nothing sells a period the end cuts short
// @requirement SC-SUB-015 — A scheduled change that comes due after the customer has left is declined and recorded
describe('a change scheduled before the customer cancelled', () => {
    const dueChange = (overrides) => ({
        tenantId: 't1',
        pendingPlan: 'STANDARD',
        pendingBillingCycle: 'YEARLY',
        canceledAt: null,
        canceledEffectiveAt: null,
        ...overrides,
    });

    function materialize(change) {
        const port = writePort();
        const service = new PendingPlanMaterializationService(
            { findDuePendingPlanChanges: async () => [change] },
            port,
            { computeLimits: async () => ({}), invalidateTenant() {} },
        );
        return service.materializeDuePlanChanges(new Date()).then((r) => ({ ...r, port }));
    }

    test('is declined once the cancellation has taken effect', async () => {
        // Applying it restarts the billing period and runs the follow-up hooks
        // — a contract freeze among them — on a term that is over.
        const { applied, port } = await materialize(
            dueChange({
                canceledAt: new Date(Date.now() - 90 * DAY),
                canceledEffectiveAt: new Date(Date.now() - 60 * DAY),
            }),
        );

        assert.equal(applied, 0);
        assert.equal(port.immediate.length, 0, 'a subscription that ended was changed');
    });

    test('but a cancellation still to come declines nothing', async () => {
        // A customer who bought a further period by cancelling late may choose
        // the plan they spend it on.
        const { applied } = await materialize(
            dueChange({
                canceledAt: new Date(),
                canceledEffectiveAt: new Date(Date.now() + 30 * DAY),
            }),
        );

        assert.equal(applied, 1);
    });

    test('and an uncancelled subscription is applied as before', async () => {
        assert.equal((await materialize(dueChange())).applied, 1);
    });
});

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
    currency: 'EUR',
    vatRate: 19,
    plans: [
        {
            id: 'STARTER',
            name: 'Starter',
            tagline: '',
            marketed: true,
            monthlyNet: 19,
            yearlyNet: 190,
            quotas: { users: 3 },
            features: ['CORE'],
        },
        {
            id: 'STANDARD',
            name: 'Standard',
            tagline: '',
            marketed: true,
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: { users: 8 },
            features: ['CORE', 'EXTRA'],
        },
    ],
};

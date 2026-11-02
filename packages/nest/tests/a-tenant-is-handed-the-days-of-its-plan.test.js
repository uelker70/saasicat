// The tenant's plan routes hand out, beside every moment of the subscription,
// of what cancelling would do, of a retirement on its way, of a plan change
// previewed or scheduled and of a cancellation declared, the days around it in
// the installation's zone — the zone `config/saas.yaml` names, UTC where it
// names none — so a page writes the day the platform decided rather than the
// one the browser's clock reads.

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { TenantBillingController } from '../dist/billing/index.js';

/** Settings as `config/saas.yaml` gives them, in a Berlin installation. */
const BERLIN = { timeZone: 'Europe/Berlin', tenantBilling: {} };
/** And in one whose file names no zone. */
const NO_ZONE = { tenantBilling: {} };
/**
 * Midnight before 1 December in Berlin: 30 November in UTC. Years ahead, since
 * the routes read the real clock and a cancellation projected now lands on
 * the period end only while it lies in the future.
 */
const MIDNIGHT_IN_BERLIN = new Date('2030-11-30T23:00:00.000Z');
const AROUND_MIDNIGHT = { until: '2030-11-30', from: '2030-12-01' };
const ON_30_NOVEMBER_IN_UTC = { until: '2030-11-30', from: '2030-11-30' };
const REQ = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

/** A running monthly subscription; `fields` override what a case is about. */
function subscriptionWith(fields = {}) {
    return {
        id: 'sub-t1',
        plan: 'STARTER',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: null,
        currentPeriodStart: null,
        currentPeriodEnd: MIDNIGHT_IN_BERLIN,
        minimumTermUntil: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: { id: 'pv-1', planId: 'STARTER', version: 1 },
        ...fields,
    };
}

/** What the preview answers: a change deferred to the period end. */
const DEFERRED_PREVIEW = {
    async planPriceNet() {
        return 49;
    },
    async preview() {
        return {
            isImmediate: false,
            effectiveAt: MIDNIGHT_IN_BERLIN,
            projectedTrialEndsAt: null,
            blockers: [],
            target: { planVersionId: 'pv-2' },
        };
    },
    async assertChangeAllowed() {
        return [];
    },
};

/** The write port a scheduled change and a cancellation go through. */
const WRITES = {
    async schedulePlanChange() {
        return { claimed: true };
    },
    async cancelSubscription(tenantId, input) {
        return {
            canceledAt: input.canceledAt,
            canceledEffectiveAt: input.effectiveAt,
            status: 'ACTIVE',
        };
    },
};

/** The routes over t1's subscription, reading days in `settings`' zone. */
function routeIn(settings, { subscription = subscriptionWith(), noticeDays, retirement } = {}) {
    return new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        DEFERRED_PREVIEW,
        { findForTenant: async () => subscription },
        { snapshot: async () => ({}) },
        WRITES,
        () => 't1',
        () => 'u1',
        // The positions between, up to the settings of `config/saas.yaml`.
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        noticeDays,
        null,
        undefined,
        undefined,
        retirement ? { pendingFor: async () => retirement } : null,
        null,
        null,
        settings,
    );
}

describe('the days of the subscription', () => {
    test('are read in the zone the settings name, for every moment it is shown', async () => {
        const usage = await routeIn(BERLIN, {
            subscription: subscriptionWith({
                status: 'TRIAL',
                trialEndsAt: MIDNIGHT_IN_BERLIN,
                startedAt: MIDNIGHT_IN_BERLIN,
                currentPeriodStart: MIDNIGHT_IN_BERLIN,
                pendingPlan: 'PRO',
                pendingBillingCycle: 'MONTHLY',
                pendingEffectiveAt: MIDNIGHT_IN_BERLIN,
                canceledAt: MIDNIGHT_IN_BERLIN,
                canceledEffectiveAt: MIDNIGHT_IN_BERLIN,
            }),
        }).getUsage(REQ);

        for (const days of [
            'trialEndsDays',
            'startedDays',
            'currentPeriodStartDays',
            'currentPeriodEndDays',
            'pendingEffectiveDays',
            'canceledDays',
            'canceledEffectiveDays',
        ]) {
            assert.deepEqual(usage[days], AROUND_MIDNIGHT, days);
        }
        assert.equal(usage.trialEndsAt, MIDNIGHT_IN_BERLIN, 'the moment stays beside its days');
    });

    test('in UTC where the settings name none', async () => {
        const usage = await routeIn(NO_ZONE).getUsage(REQ);

        assert.deepEqual(usage.currentPeriodEndDays, ON_30_NOVEMBER_IN_UTC);
    });

    test('name none beside a moment that is absent', async () => {
        const usage = await routeIn(BERLIN).getUsage(REQ);

        assert.equal(usage.trialEndsDays, null);
        assert.equal(usage.canceledEffectiveDays, null);
        assert.equal(usage.pilotEndsDay, null);
        assert.equal(usage.retirement, null);
        assert.equal(usage.packageSnapshotCapturedDays, null);
    });

    test('a pilot ends on the day that was picked, whatever the zone', async () => {
        // Stored as its UTC midnight, which is 19:00 the day before in New York.
        const pilotEndsAt = new Date('2030-12-01T00:00:00.000Z');
        const usage = await routeIn(
            { timeZone: 'America/New_York', tenantBilling: {} },
            { subscription: subscriptionWith({ isPilot: true, pilotEndsAt }) },
        ).getUsage(REQ);

        assert.equal(usage.pilotEndsDay, '2030-12-01');
    });

    test('the end of a cancellation declared before the effective date was stored is that date', async () => {
        // Such a row carries the effective date in `canceledAt` alone; the
        // answer reads it there, and so do its days.
        const usage = await routeIn(BERLIN, {
            subscription: subscriptionWith({ canceledAt: MIDNIGHT_IN_BERLIN }),
        }).getUsage(REQ);

        assert.deepEqual(usage.canceledEffectiveDays, AROUND_MIDNIGHT);
    });
});

describe('the days of what the account says is ahead', () => {
    test('what cancelling now would do names the days of its date, its term and its deadline', async () => {
        const usage = await routeIn(BERLIN, { noticeDays: { monthly: 30, yearly: 30 } }).getUsage(
            REQ,
        );

        assert.deepEqual(usage.cancellation.effectiveDays, AROUND_MIDNIGHT);
        assert.deepEqual(usage.cancellation.termEndsDays, AROUND_MIDNIGHT);
        // Thirty days before it: midnight before 1 November.
        assert.deepEqual(usage.cancellation.noticeDeadlineDays, {
            until: '2030-10-31',
            from: '2030-11-01',
        });
    });

    test('and no deadline where no notice is owed', async () => {
        const usage = await routeIn(BERLIN).getUsage(REQ);

        assert.equal(usage.cancellation.noticeDeadlineDays, null);
    });

    test('a retirement on its way names the days of when it takes effect, and keeps its last day', async () => {
        const usage = await routeIn(BERLIN, {
            retirement: {
                kind: 'version-retired',
                effectiveAt: MIDNIGHT_IN_BERLIN.toISOString(),
                lastDayToCancel: '2030-11-30',
            },
        }).getUsage(REQ);

        assert.deepEqual(usage.retirement.effectiveDays, AROUND_MIDNIGHT);
        assert.equal(usage.retirement.lastDayToCancel, '2030-11-30');
    });

    test('a package snapshot names the days of when it was captured', async () => {
        const capturedAt = MIDNIGHT_IN_BERLIN.toISOString();
        const usage = await routeIn(BERLIN, {
            subscription: subscriptionWith({ packageSnapshot: { planId: 'STARTER', capturedAt } }),
        }).getUsage(REQ);

        assert.deepEqual(usage.packageSnapshotCapturedDays, AROUND_MIDNIGHT);
        assert.deepEqual(
            usage.packageSnapshot,
            { planId: 'STARTER', capturedAt },
            'kept as frozen',
        );
    });

    test('one that carries no moment it was captured at names none, and the read goes on', async () => {
        for (const packageSnapshot of [{ planId: 'STARTER' }, { capturedAt: 'yesterday' }]) {
            const usage = await routeIn(BERLIN, {
                subscription: subscriptionWith({ packageSnapshot }),
            }).getUsage(REQ);

            assert.equal(usage.packageSnapshotCapturedDays, null, JSON.stringify(packageSnapshot));
        }
    });
});

describe('the days of a change and of a cancellation', () => {
    test('a plan change’s preview names the days of when it would take effect', async () => {
        const preview = await routeIn(BERLIN).previewPlanChange(REQ, {
            plan: 'PRO',
            billingCycle: 'MONTHLY',
        });

        assert.deepEqual(preview.effectiveDays, AROUND_MIDNIGHT);
        assert.equal(preview.projectedTrialEndsDays, null);
    });

    test('a scheduled change names the days of when it lands', async () => {
        const changed = await routeIn(BERLIN).changePlan(REQ, {
            plan: 'PRO',
            billingCycle: 'MONTHLY',
            planVersionId: 'pv-2',
        });

        assert.equal(changed.immediate, false);
        assert.deepEqual(changed.pendingEffectiveDays, AROUND_MIDNIGHT);
    });

    test('a cancellation declared names the days of when it was declared and when it lands', async () => {
        const declared = await routeIn(BERLIN, {
            noticeDays: { monthly: 30, yearly: 30 },
        }).cancelSubscription(REQ, {});

        assert.deepEqual(declared.canceledEffectiveDays, AROUND_MIDNIGHT);
        assert.deepEqual(declared.termEndsDays, AROUND_MIDNIGHT);
        assert.deepEqual(declared.noticeDeadlineDays, { until: '2030-10-31', from: '2030-11-01' });
        assert.notEqual(declared.canceledDays, null);
    });

    test('and a repeat names the days of the date it already had', async () => {
        const declared = await routeIn(BERLIN, {
            subscription: subscriptionWith({
                canceledAt: new Date('2030-10-01T08:00:00.000Z'),
                canceledEffectiveAt: MIDNIGHT_IN_BERLIN,
            }),
        }).cancelSubscription(REQ, {});

        assert.equal(declared.alreadyCanceled, true);
        assert.deepEqual(declared.canceledEffectiveDays, AROUND_MIDNIGHT);
        assert.equal(declared.termEndsDays, null);
    });
});

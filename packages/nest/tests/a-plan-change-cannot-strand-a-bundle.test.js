import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlanChangePreviewService } from '../dist/billing/index.js';

// A rule enforced only where a thing is created is a rule with a back door.
//
// A bundle may run in a shorter rhythm than its plan, never a longer one — and
// that was checked when a bundle is booked, and nowhere else. A yearly add-on
// bought beside a yearly plan survives a move to a monthly one, and the booking
// then sits in the state the model calls impossible: committed for a year
// beside a plan that ends twelve times before its period does, each of those a
// moment the plan could stop and leave it with nothing to grant.
//
// Refused rather than converted or ended. Ending it early owes the customer the
// difference, which is what the alignment exists to avoid; converting it
// invents a price nobody agreed to. Cancelling the add-on is the tenant's own
// act, and then the change goes through.

const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demo',
    currency: 'EUR',
    vatRate: 19,
    plans: [
        {
            id: 'PRO',
            name: 'Pro',
            tagline: '',
            marketed: true,
            monthlyNet: 49,
            yearlyNet: 490,
            quotas: { users: 8 },
            features: ['CORE'],
        },
    ],
};

const entitlement = {
    computeLimits: async () => ({
        plan: 'PRO',
        quotas: { users: 8 },
        features: new Set(['CORE']),
    }),
    invalidateTenant: () => {},
};

const subscriptions = {
    findForTenant: async () => ({
        id: 'sub-1',
        plan: 'PRO',
        billingCycle: 'YEARLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: new Date('2026-01-01'),
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: new Date('2027-01-01'),
        minimumTermUntil: null,
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: {
            id: 'pv1',
            planId: 'PRO',
            version: 1,
            publishedAt: null,
            supersededAt: null,
            changeNote: null,
        },
        pendingPlanVersion: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
    }),
};

const NOW = new Date('2026-06-15');

function bookingsRepo(bookings) {
    return { listActiveBySubscription: async () => bookings };
}

function preview(targetCycle, bookings) {
    const service = new PlanChangePreviewService(
        CATALOG,
        entitlement,
        subscriptions,
        { snapshot: async () => ({ users: 1 }) },
        null,
        null,
        bookings === null ? null : bookingsRepo(bookings),
    );
    return service.preview('t1', 'PRO', targetCycle, NOW);
}

const YEARLY_BOOKING = {
    id: 'sb-1',
    billingCycle: 'YEARLY',
    currentPeriodEnd: new Date('2027-01-01'),
    minimumTermEndsAt: null,
};

const hasCycleBlocker = (dto) => dto.blockers.some((b) => b.code === 'BUNDLE_CYCLE_EXCEEDS_PLAN');

describe('moving to a shorter cycle with a longer add-on booked', () => {
    test('a yearly add-on blocks the move to a monthly plan', async () => {
        const dto = await preview('MONTHLY', [YEARLY_BOOKING]);
        assert.ok(hasCycleBlocker(dto), `expected a blocker, got ${JSON.stringify(dto.blockers)}`);
    });

    test('the blocker names the date the add-on runs to, so the tenant can act', async () => {
        const dto = await preview('MONTHLY', [YEARLY_BOOKING]);
        const blocker = dto.blockers.find((b) => b.code === 'BUNDLE_CYCLE_EXCEEDS_PLAN');
        assert.match(blocker.message, /2027-01-01/);
        assert.match(blocker.message, /cancel the add-on/);
    });

    test('staying on the yearly cycle is not blocked', async () => {
        const dto = await preview('YEARLY', [YEARLY_BOOKING]);
        assert.equal(hasCycleBlocker(dto), false);
    });

    test('a monthly add-on does not block a monthly plan', async () => {
        const dto = await preview('MONTHLY', [
            {
                ...YEARLY_BOOKING,
                billingCycle: 'MONTHLY',
                currentPeriodEnd: new Date('2026-07-01'),
            },
        ]);
        assert.equal(hasCycleBlocker(dto), false);
    });

    test('an add-on with no rhythm of its own follows the plan and blocks nothing', async () => {
        // Booked before bundles had a rhythm: it is billed with the plan, so it
        // fits any plan by construction.
        const dto = await preview('MONTHLY', [
            { ...YEARLY_BOOKING, billingCycle: null, currentPeriodEnd: null },
        ]);
        assert.equal(hasCycleBlocker(dto), false);
    });

    test('no active bookings, nothing to block', async () => {
        const dto = await preview('MONTHLY', []);
        assert.equal(hasCycleBlocker(dto), false);
    });

    test('a consumer without the bundle module is not blocked by bookings it cannot have', async () => {
        const dto = await preview('MONTHLY', null);
        assert.equal(hasCycleBlocker(dto), false);
    });

    test('the date falls back to the minimum term where no period is stored', async () => {
        const dto = await preview('MONTHLY', [
            {
                ...YEARLY_BOOKING,
                currentPeriodEnd: null,
                minimumTermEndsAt: new Date('2026-12-01'),
            },
        ]);
        const blocker = dto.blockers.find((b) => b.code === 'BUNDLE_CYCLE_EXCEEDS_PLAN');
        assert.match(blocker.message, /2026-12-01/);
    });
});

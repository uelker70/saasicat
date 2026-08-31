// @requirement SC-BUN-012 — An add-on can never be committed past the subscription that pays for it
// @requirement SC-BUN-029 — A move to a shorter plan rhythm is refused while a longer add-on is running

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlanChangePreviewService } from '../dist/billing/index.js';
import { ERROR_MESSAGES_DE, ERROR_MESSAGES_EN, resolveErrorMessage } from '@saasicat/core';

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
    app: { name: 'Test App' },
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

const hasCycleBlocker = (dto) =>
    dto.blockers.some((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE');

describe('moving to a shorter cycle with a longer add-on booked', () => {
    test('a yearly add-on blocks the move to a monthly plan', async () => {
        const dto = await preview('MONTHLY', [YEARLY_BOOKING]);
        assert.ok(hasCycleBlocker(dto), `expected a blocker, got ${JSON.stringify(dto.blockers)}`);
    });

    test('the blocker names the date the add-on runs to, so the tenant can act', async () => {
        const dto = await preview('MONTHLY', [YEARLY_BOOKING]);
        const blocker = dto.blockers.find((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE');
        assert.match(blocker.message, /2027-01-01/);
        assert.match(blocker.message, /cancel the bundle/);
    });

    // The date and the instruction are the whole value of this blocker, and a
    // tenant reads it in their own language — so they have to survive the trip
    // through the catalogue, not just sit in the English `message`.
    //
    // Its own code for that reason. `BUNDLE_CYCLE_EXCEEDS_PLAN` states the same
    // rule for a booking nobody has made yet: it can name no date, and "cancel
    // the bundle first" is advice its reader cannot act on. Sharing one code
    // meant sharing one sentence, and the sentence that fits both says neither.
    test('and says both in either language, not only in the English message', async () => {
        const dto = await preview('MONTHLY', [YEARLY_BOOKING]);
        const blocker = dto.blockers.find((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE');

        assert.equal(
            resolveErrorMessage(blocker, {}, ERROR_MESSAGES_EN),
            'A yearly bundle is booked until 2027-01-01. A monthly plan cannot carry it — cancel the bundle first, or keep the yearly cycle.',
        );
        assert.equal(
            resolveErrorMessage(blocker, {}, ERROR_MESSAGES_DE),
            'Ein jährlich abgerechnetes Bundle ist bis 2027-01-01 gebucht. Ein monatlich abgerechnetes Paket kann es nicht tragen — kündigen Sie das Bundle zuerst, oder behalten Sie den jährlichen Rhythmus.',
        );
    });

    // The cycle words are part of each locale's sentence rather than values
    // filled into it, because the direction is determined — `bundleCycleFitsPlan`
    // refuses only a yearly bundle beside a monthly plan. A German template
    // interpolating them would read "Ein monthly Paket".
    test('the German sentence carries no English cycle word', async () => {
        const dto = await preview('MONTHLY', [YEARLY_BOOKING]);
        const blocker = dto.blockers.find((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE');
        const german = resolveErrorMessage(blocker, {}, ERROR_MESSAGES_DE);

        for (const word of ['monthly', 'yearly', 'MONTHLY', 'YEARLY']) {
            assert.ok(!german.includes(word), `"${word}" leaked into: ${german}`);
        }
        // The values still travel, as data rather than as prose.
        assert.equal(blocker.params.billingCycle, 'yearly');
        assert.equal(blocker.params.planCycle, 'monthly');
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

    test('moving to a LONGER cycle with a monthly add-on is fine', async () => {
        // The rule is one-directional: shorter than the plan is allowed, longer
        // is not. A monthly add-on beside a yearly plan simply lands on the
        // plan's day every month — the interesting case, and a permitted one.
        const monthlyOnYearly = new PlanChangePreviewService(
            CATALOG,
            entitlement,
            {
                findForTenant: async () => ({
                    ...(await subscriptions.findForTenant()),
                    billingCycle: 'MONTHLY',
                    currentPeriodEnd: new Date('2026-07-01'),
                }),
            },
            { snapshot: async () => ({ users: 1 }) },
            null,
            null,
            bookingsRepo([
                {
                    ...YEARLY_BOOKING,
                    billingCycle: 'MONTHLY',
                    currentPeriodEnd: new Date('2026-07-01'),
                },
            ]),
        );
        const dto = await monthlyOnYearly.preview('t1', 'PRO', 'YEARLY', NOW);
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
        const blocker = dto.blockers.find((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE');
        assert.match(blocker.message, /2026-12-01/);
    });
});

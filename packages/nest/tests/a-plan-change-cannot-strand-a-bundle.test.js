// @requirement SC-BUN-012 — An add-on can never be committed past the subscription that pays for it
// @requirement SC-BUN-029 — A move to a shorter plan rhythm is refused while a longer add-on is running

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PlanChangePreviewService, givenPlanCatalogSource } from '../dist/billing/index.js';
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
    }),
};

const NOW = new Date('2026-06-15');

function bookingsRepo(bookings) {
    return { listActiveBySubscription: async () => bookings };
}

/** Reports, which any plan may book, in either rhythm. */
const REPORTS = {
    async findVersionById(id) {
        return {
            id,
            label: 'Reports',
            compatibility: {},
            pricingOverrides: [],
            monthlyNet: '5.00',
            yearlyNet: '50.00',
        };
    },
};

function preview(
    targetCycle,
    bookings,
    { versions = REPORTS, addOnsAhead = null, subscription = {} } = {},
) {
    const service = new PlanChangePreviewService(
        givenPlanCatalogSource(CATALOG),
        entitlement,
        {
            findForTenant: async () => ({
                ...(await subscriptions.findForTenant()),
                ...subscription,
            }),
        },
        { snapshot: async () => ({ users: 1 }) },
        null,
        null,
        bookings === null ? null : bookingsRepo(bookings),
        null,
        null,
        versions,
        addOnsAhead,
    );
    return service.preview('t1', 'PRO', targetCycle, NOW);
}

const YEARLY_BOOKING = {
    id: 'sb-1',
    bundleVersionId: 'bv-reports',
    billingCycle: 'YEARLY',
    canceledAt: null,
    canceledEffectiveAt: null,
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

    test('the blocker names the add-on and the date it runs to, so the tenant can act', async () => {
        const dto = await preview('MONTHLY', [YEARLY_BOOKING]);
        const blocker = dto.blockers.find((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE');
        assert.equal(blocker.params.bundleName, 'Reports');
        assert.equal(blocker.params.until, '2027-01-01');
        assert.match(blocker.message, /Once it is cancelled/);
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
            'Reports is billed yearly and runs until 2027-01-01 at the earliest, which a monthly plan cannot carry. Once it is cancelled, a change that takes effect on or after that day goes through — or keep the yearly cycle.',
        );
        assert.equal(
            resolveErrorMessage(blocker, {}, ERROR_MESSAGES_DE),
            'Reports wird jährlich abgerechnet und läuft frühestens bis 2027-01-01; ein monatlich abgerechnetes Paket kann es nicht tragen. Ist es gekündigt, geht ein Wechsel durch, der an diesem Tag oder später wirksam wird — oder behalten Sie den jährlichen Rhythmus.',
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
            givenPlanCatalogSource(CATALOG),
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

    // A booking that stores no period of its own runs with the plan's, so a
    // cancellation of it lands where the cancel route would put it: at the
    // plan's period end, or at a commitment running longer.
    test("where no period is stored, the date is the plan's period end or a longer commitment", async () => {
        const untilWithCommitment = async (minimumTermEndsAt) => {
            const dto = await preview('MONTHLY', [
                { ...YEARLY_BOOKING, currentPeriodEnd: null, minimumTermEndsAt },
            ]);
            return dto.blockers.find((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE')
                .params.until;
        };
        assert.equal(await untilWithCommitment(new Date('2026-12-01')), '2027-01-01');
        assert.equal(await untilWithCommitment(new Date('2027-03-01')), '2027-03-01');
    });
});

// @requirement SC-BUN-044 — An add-on retirement's replacement has to fit every plan a booking meets from its date
describe('a plan change, and an add-on told it continues on another version', () => {
    // Reports v1 runs on any plan; v2, which the booking was told it continues
    // on, is sold beside Enterprise only.
    const versions = {
        async findVersionById(id) {
            const v2 = id === 'bv-reports-2';
            return {
                id,
                label: 'Reports',
                version: v2 ? 2 : 1,
                compatibility: { planIds: v2 ? ['ENTERPRISE'] : [] },
                pricingOverrides: [],
                monthlyNet: '5.00',
                yearlyNet: '50.00',
            };
        },
    };
    const monthly = { ...YEARLY_BOOKING, billingCycle: 'MONTHLY' };
    const toldOnto = (replacementBundleVersionId, effectiveAt = '2026-10-01T00:00:00.000Z') => ({
        of: async () => [
            {
                subscriptionBundleId: 'sb-1',
                retiredBundleVersionId: 'bv-reports',
                replacementBundleVersionId,
                effectiveAt,
            },
        ],
    });
    const fitBlockers = (dto) =>
        dto.blockers.filter((b) => b.code === 'BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN');
    const continuationBlockers = (dto) =>
        dto.blockers.filter((b) => b.code === 'BUNDLE_REPLACEMENT_DOES_NOT_FIT_TARGET_PLAN');

    test('is refused where the version it continues on cannot run beside the target plan, naming that version', async () => {
        const dto = await preview('MONTHLY', [monthly], {
            versions,
            addOnsAhead: toldOnto('bv-reports-2'),
        });

        // v1 runs beside Pro; only v2 does not, and a cancelled booking never
        // reaches it — so the refusal says to cancel, not how long to wait.
        assert.deepEqual(fitBlockers(dto), []);
        assert.deepEqual(
            continuationBlockers(dto).map((b) => b.params),
            [{ bundleName: 'Reports', version: '2', from: '2026-10-01', planName: 'Pro' }],
        );
    });

    test('goes through where that version can run beside it', async () => {
        const dto = await preview('MONTHLY', [monthly], {
            versions,
            addOnsAhead: toldOnto('bv-reports-1b'),
        });

        assert.deepEqual(fitBlockers(dto), []);
        assert.deepEqual(continuationBlockers(dto), []);
    });

    // @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
    test('a switch the booking took for the end of its term is asked the same way, from its date', async () => {
        const switching = (to) => ({
            ...monthly,
            pendingBundleVersionId: to,
            pendingVersionEffectiveAt: new Date('2026-07-01T00:00:00.000Z'),
        });

        const refused = await preview('MONTHLY', [switching('bv-reports-2')], { versions });
        const fits = await preview('MONTHLY', [switching('bv-reports-1b')], { versions });

        assert.deepEqual(
            continuationBlockers(refused).map((b) => b.params),
            [{ bundleName: 'Reports', version: '2', from: '2026-07-01', planName: 'Pro' }],
        );
        assert.deepEqual(continuationBlockers(fits), []);
    });

    // @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
    test('a switch the booking took lifts no minimum term from the day it can end', async () => {
        const standardOnly = {
            async findVersionById(id) {
                return {
                    ...(await versions.findVersionById(id)),
                    compatibility: { planIds: id === 'bv-reports' ? ['STANDARD'] : [] },
                };
            },
        };
        const committed = {
            ...monthly,
            currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
            minimumTermEndsAt: new Date('2027-03-01T00:00:00.000Z'),
            pendingBundleVersionId: 'bv-reports-1b',
            pendingVersionEffectiveAt: new Date('2026-07-01T00:00:00.000Z'),
        };

        const dto = await preview('MONTHLY', [committed], { versions: standardOnly });

        assert.deepEqual(
            fitBlockers(dto).map((b) => b.params.until),
            ['2027-03-01'],
        );
    });

    test('asks nothing of a booking that ends before its version would change', async () => {
        const dto = await preview(
            'MONTHLY',
            [{ ...monthly, canceledEffectiveAt: new Date('2026-07-01T00:00:00.000Z') }],
            { versions, addOnsAhead: toldOnto('bv-reports-2') },
        );

        assert.deepEqual(fitBlockers(dto), []);
        assert.deepEqual(continuationBlockers(dto), []);
    });

    test('asks nothing of a booking whose subscription ends by its date, and asks one that runs past it', async () => {
        const subscriptionEnding = (endsAt) =>
            preview('MONTHLY', [monthly], {
                versions,
                addOnsAhead: toldOnto('bv-reports-2'),
                subscription: {
                    canceledAt: new Date('2026-06-01T00:00:00.000Z'),
                    canceledEffectiveAt: new Date(endsAt),
                },
            });

        const endingBy = await subscriptionEnding('2026-10-01T00:00:00.000Z');
        const endingAfter = await subscriptionEnding('2026-11-01T00:00:00.000Z');

        assert.deepEqual(continuationBlockers(endingBy), []);
        assert.equal(continuationBlockers(endingAfter).length, 1);
    });

    test('tells a booking under a minimum term to cancel, which the retirement lets it do', async () => {
        const committed = {
            ...monthly,
            currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
            minimumTermEndsAt: new Date('2027-06-01T00:00:00.000Z'),
        };

        const dto = await preview('MONTHLY', [committed], {
            versions,
            addOnsAhead: toldOnto('bv-reports-2'),
        });

        // No day to wait for: cancelled, it ends with its period on 1 July,
        // before the date, the term lapsing under the retirement.
        assert.deepEqual(Object.keys(continuationBlockers(dto)[0].params).sort(), [
            'bundleName',
            'from',
            'planName',
            'version',
        ]);
    });

    test('names the end of its period as well where the version it is on cannot run beside the plan', async () => {
        const yearly = {
            ...YEARLY_BOOKING,
            currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
            minimumTermEndsAt: new Date('2027-06-01T00:00:00.000Z'),
        };

        const dto = await preview('MONTHLY', [yearly], {
            versions,
            addOnsAhead: toldOnto('bv-reports-2'),
        });

        const blocker = dto.blockers.find((b) => b.code === 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE');
        assert.equal(blocker?.params.until, '2026-07-01');
    });

    test('names the day it can end instead once the date has passed and the move is still to come', async () => {
        const dto = await preview('MONTHLY', [monthly], {
            versions,
            addOnsAhead: toldOnto('bv-reports-2', '2026-06-01T00:00:00.000Z'),
        });

        // Cancelled now, it would land after the date: cancelling no longer
        // keeps it off version 2.
        assert.deepEqual(continuationBlockers(dto), []);
        assert.equal(fitBlockers(dto).length, 1);
    });

    test('names the day a booking cancelled already ends, which cancelling again cannot move', async () => {
        const cancelled = {
            ...monthly,
            canceledAt: new Date('2026-05-01T00:00:00.000Z'),
            canceledEffectiveAt: new Date('2027-01-01T00:00:00.000Z'),
        };

        const dto = await preview('MONTHLY', [cancelled], {
            versions,
            addOnsAhead: toldOnto('bv-reports-2'),
        });

        assert.deepEqual(continuationBlockers(dto), []);
        assert.equal(fitBlockers(dto)[0].params.until, '2027-01-01');
    });

    test('asks nothing of a retirement told for a version the booking is no longer on', async () => {
        const dto = await preview('MONTHLY', [{ ...monthly, bundleVersionId: 'bv-reports-3' }], {
            versions,
            addOnsAhead: toldOnto('bv-reports-2'),
        });

        assert.deepEqual(fitBlockers(dto), []);
    });
});

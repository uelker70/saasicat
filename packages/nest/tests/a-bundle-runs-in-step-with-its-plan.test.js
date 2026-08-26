import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SubscriptionBundlesService,
    bundleCycleFitsPlan,
    bundleFirstPeriodEnd,
    bundleFirstPeriodStart,
    bundleNextPeriodEnd,
    computeNextBundlePeriod,
    retreatOneCycle,
} from '../dist/billing/index.js';

// A bundle ends on the day its plan does.
//
// It hangs off the plan that pays for it, so the two have to run out together:
// otherwise a plan cancellation leaves a bundle with nothing to grant, or the
// bundle has to be trimmed and somebody is owed the difference. Aligning at
// booking means the trimming case never arises — which is why this is arithmetic
// at the start rather than a repair at the end.
//
// The first period is short, from the booking to the next occurrence of the
// plan's billing day, and is charged pro rata for exactly that stretch. Every
// period after it runs anchor to anchor, in step with the plan for as long as
// both live.

const at = (s) => new Date(`${s}T00:00:00.000Z`);
const iso = (d) => (d === null ? null : d.toISOString().slice(0, 10));

/** Walks the bundle's periods the way a billing job would. */
function walk(firstEnd, cycle, anchor, steps) {
    const seen = [iso(firstEnd)];
    let end = firstEnd;
    for (let i = 0; i < steps; i += 1) {
        end = bundleNextPeriodEnd(end, cycle, anchor);
        seen.push(iso(end));
    }
    return seen;
}

describe('a monthly bundle on a yearly plan ending on the 31st', () => {
    // The maintainer's first worked example, end to end.
    const first = bundleFirstPeriodEnd({
        startedAt: at('2026-02-21'),
        cycle: 'MONTHLY',
        planPeriodEnd: at('2026-07-31'),
        planAnchorDay: 31,
    });

    test('bills the first, short period to the end of February', () => {
        assert.equal(iso(first), '2026-02-28');
    });

    test('and every month after it to the plan day, landing with the plan', () => {
        assert.deepEqual(walk(first, 'MONTHLY', 31, 5), [
            '2026-02-28',
            '2026-03-31',
            '2026-04-30',
            '2026-05-31',
            '2026-06-30',
            '2026-07-31',
        ]);
    });
});

describe('a monthly bundle on a yearly plan ending on the 17th', () => {
    // The second example: an anchor no month is too short for, so nothing is
    // ever clamped and the first period crosses a month boundary.
    const first = bundleFirstPeriodEnd({
        startedAt: at('2026-02-21'),
        cycle: 'MONTHLY',
        planPeriodEnd: at('2026-07-17'),
        planAnchorDay: 17,
    });

    test('runs its first period past the month end, to the plan day', () => {
        assert.equal(iso(first), '2026-03-17');
    });

    test('and lands on the plan with every month between', () => {
        assert.deepEqual(walk(first, 'MONTHLY', 17, 4), [
            '2026-03-17',
            '2026-04-17',
            '2026-05-17',
            '2026-06-17',
            '2026-07-17',
        ]);
    });
});

describe('a bundle booked on the plan day itself', () => {
    test('gets a whole period rather than an empty one', () => {
        // Booked ON the anchor: the day has passed for this month, so the first
        // period runs to the next one. A zero-length first period would be a
        // charge for nothing.
        const first = bundleFirstPeriodEnd({
            startedAt: at('2026-02-17'),
            cycle: 'MONTHLY',
            planPeriodEnd: at('2026-07-17'),
            planAnchorDay: 17,
        });

        assert.equal(iso(first), '2026-03-17');
    });

    test('while the day before it gets the short one it is entitled to', () => {
        const first = bundleFirstPeriodEnd({
            startedAt: at('2026-02-16'),
            cycle: 'MONTHLY',
            planPeriodEnd: at('2026-07-17'),
            planAnchorDay: 17,
        });

        assert.equal(iso(first), '2026-02-17');
    });
});

describe('a yearly bundle', () => {
    test('meets the plan on its own boundary, month and day together', () => {
        // A day of the month says nothing about which month, so a yearly bundle
        // has to land on the plan's date rather than on its anchor.
        const first = bundleFirstPeriodEnd({
            startedAt: at('2026-02-21'),
            cycle: 'YEARLY',
            planPeriodEnd: at('2026-07-17'),
            planAnchorDay: 17,
        });

        assert.equal(iso(first), '2026-07-17');
    });

    test('and takes the following year when booked after that boundary', () => {
        const first = bundleFirstPeriodEnd({
            startedAt: at('2026-08-01'),
            cycle: 'YEARLY',
            planPeriodEnd: at('2026-07-17'),
            planAnchorDay: 17,
        });

        assert.equal(iso(first), '2027-07-17');
    });
});

describe('a plan with no period at all', () => {
    test('gives the bundle no period either, rather than an invented one', () => {
        // A trial, or a subscription still waiting for sales. There is no
        // boundary to align to, and picking one from the booking date would
        // commit the customer to a rhythm nobody agreed on.
        const first = bundleFirstPeriodEnd({
            startedAt: at('2026-02-21'),
            cycle: 'MONTHLY',
            planPeriodEnd: null,
            planAnchorDay: null,
        });

        assert.equal(first, null);
    });
});

describe('a plan whose anchor is not stored', () => {
    test('falls back to the day its period ends on', () => {
        // The additive half: a row written before the anchor column exists
        // still aligns, using the only day it has.
        const first = bundleFirstPeriodEnd({
            startedAt: at('2026-02-21'),
            cycle: 'MONTHLY',
            planPeriodEnd: at('2026-07-17'),
            planAnchorDay: null,
        });

        assert.equal(iso(first), '2026-03-17');
    });
});

describe('which cycles a bundle may be sold on', () => {
    // A bundle may run in a shorter rhythm than its plan, never a longer one.
    // A yearly bundle on a monthly plan has no boundary to meet: the plan's
    // periods end twelve times before the bundle's first one does, and every
    // one of those ends is a moment the plan could stop and leave the bundle
    // committed with nothing to grant.
    const cases = [
        ['MONTHLY', 'MONTHLY', true],
        ['MONTHLY', 'YEARLY', true],
        ['YEARLY', 'YEARLY', true],
        ['YEARLY', 'MONTHLY', false],
    ];

    test('every combination, not three of the four', () => {
        // Enumerated rather than sampled: a rule that is right for the wrong
        // reason passes any three interesting examples.
        assert.equal(cases.length, 4);
    });

    for (const [bundle, plan, allowed] of cases) {
        test(`${bundle} bundle on a ${plan} plan is ${allowed ? 'allowed' : 'refused'}`, () => {
            assert.equal(bundleCycleFitsPlan(bundle, plan), allowed);
        });
    }
});

describe('booking one, through the service that writes it', () => {
    // The rule above proved in isolation; this is the booking a tenant makes,
    // with the window and the term it is actually stored with.
    const bundleVersion = {
        id: 'bv-1',
        bundleId: 'b-1',
        publishedAt: at('2025-01-01'),
        supersededAt: null,
        compatibility: {},
        features: ['F'],
        // A bundle nobody can be charged for cannot be booked; a fixture
        // without a price would describe a state the platform refuses.
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        pricingOverrides: [],
    };

    function service() {
        const added = [];
        const svc = new SubscriptionBundlesService(
            {
                add: async (data) => {
                    added.push(data);
                    return { id: 'sb-1', ...data };
                },
                listBySubscription: async () => [],
                listActiveBySubscription: async () => [],
                findById: async () => null,
            },
            { findVersionById: async () => bundleVersion },
            { defaultMinimumTermMonths: 12 },
        );
        return { svc, added };
    }

    const book = (svc, overrides = {}) =>
        svc.addBundleToSubscription({
            subscriptionId: 'sub-1',
            bundleVersionId: 'bv-1',
            currentPlanKey: 'STANDARD',
            startedAt: at('2026-02-21'),
            parentEndsAt: null,
            planCycle: 'YEARLY',
            planPeriodEnd: at('2026-07-31'),
            planAnchorDay: 31,
            ...overrides,
        });

    test('a monthly bundle on a yearly plan is stored with the short first period', async () => {
        const { svc, added } = service();

        await book(svc, { billingCycle: 'MONTHLY' });

        assert.equal(added[0].billingCycle, 'MONTHLY');
        assert.equal(iso(added[0].currentPeriodStart), '2026-02-21');
        assert.equal(iso(added[0].currentPeriodEnd), '2026-02-28');
    });

    test('and defaults to the rhythm of the plan when the tenant does not choose', async () => {
        const { svc, added } = service();

        await book(svc);

        assert.equal(added[0].billingCycle, 'YEARLY');
        assert.equal(iso(added[0].currentPeriodEnd), '2026-07-31');
    });

    test('while a yearly bundle on a monthly plan is refused outright', async () => {
        // Premise 3, and the reason it is a refusal rather than a clamp: there
        // is no yearly boundary on a monthly plan to align to.
        const { svc, added } = service();

        await assert.rejects(
            book(svc, { billingCycle: 'YEARLY', planCycle: 'MONTHLY', planAnchorDay: 15 }),
            (err) => err.getResponse?.().code === 'BUNDLE_CYCLE_EXCEEDS_PLAN',
        );
        assert.equal(added.length, 0);
    });

    test('and a monthly bundle on a monthly plan is not', async () => {
        // The premise for the refusal: it is about the longer rhythm, not about
        // choosing one at all.
        const { svc, added } = service();

        await book(svc, {
            billingCycle: 'MONTHLY',
            planCycle: 'MONTHLY',
            planPeriodEnd: at('2026-03-15'),
            planAnchorDay: 15,
        });

        assert.equal(added.length, 1);
        assert.equal(iso(added[0].currentPeriodEnd), '2026-03-15');
    });
});

describe('a bundle nobody can be charged for is not booked', () => {
    // The preview reports this as a blocker, and a blocker the mutation does
    // not enforce is enforcement in the client: a caller that posts straight to
    // the route never sees it. The publish gate cannot answer this one either —
    // it knows the bundle has *some* price, not whether one exists for the plan
    // and rhythm in front of it.

    const priced = {
        id: 'bv-priced',
        bundleId: 'b-1',
        publishedAt: at('2025-01-01'),
        supersededAt: null,
        compatibility: {},
        features: ['F'],
        monthlyNet: '9.90',
        yearlyNet: null,
        pricingOverrides: [],
    };

    function serviceFor(bundleVersion) {
        return new SubscriptionBundlesService(
            {
                add: async (data) => ({ id: 'sb-1', ...data }),
                listBySubscription: async () => [],
                listActiveBySubscription: async () => [],
                findById: async () => null,
            },
            { findVersionById: async () => bundleVersion },
            { defaultMinimumTermMonths: 0 },
        );
    }

    const book = (svc, overrides = {}) =>
        svc.addBundleToSubscription({
            subscriptionId: 'sub-1',
            bundleVersionId: priced.id,
            currentPlanKey: 'STANDARD',
            startedAt: at('2026-02-21'),
            parentEndsAt: null,
            planCycle: 'MONTHLY',
            planPeriodEnd: at('2026-03-21'),
            planAnchorDay: 21,
            ...overrides,
        });

    test('a rhythm the bundle has no price in is refused', async () => {
        await assert.rejects(
            () =>
                book(serviceFor(priced), {
                    planCycle: 'YEARLY',
                    planPeriodEnd: at('2027-01-01'),
                    planAnchorDay: 1,
                    billingCycle: 'YEARLY',
                }),
            (err) => err.getResponse?.().code === 'BUNDLE_NOT_PRICED_FOR_THIS_PLAN',
        );
    });

    test('the rhythm it does have a price in goes through', async () => {
        const booked = await book(serviceFor(priced));
        assert.equal(booked.billingCycle, 'MONTHLY');
    });

    test('a plan override that resolves nothing is refused as well', async () => {
        // An override wins over the base price, including when it removes it —
        // that is what an override is for, and it is exactly how a bundle ends
        // up unpriced for one plan while priced for the rest.
        const overridden = {
            ...priced,
            pricingOverrides: [{ planId: 'STANDARD', monthlyNet: null, yearlyNet: null }],
        };
        await assert.rejects(
            () => book(serviceFor(overridden)),
            (err) => err.getResponse?.().code === 'BUNDLE_NOT_PRICED_FOR_THIS_PLAN',
        );
    });

    test('an override that resolves a price for one plan books for that plan', async () => {
        const overridden = {
            ...priced,
            monthlyNet: null,
            pricingOverrides: [{ planId: 'STANDARD', monthlyNet: '4.90', yearlyNet: null }],
        };
        const booked = await book(serviceFor(overridden));
        assert.equal(booked.subscriptionId, 'sub-1');
        // …and refuses the plan the override does not cover.
        await assert.rejects(
            () => book(serviceFor(overridden), { currentPlanKey: 'OTHER' }),
            (err) => err.getResponse?.().code === 'BUNDLE_NOT_PRICED_FOR_THIS_PLAN',
        );
    });
});

describe('what the short first period costs', () => {
    // A short period is charged pro rata against a WHOLE cycle, and a whole
    // cycle is only measurable from both of its ends. The plan's period is the
    // wrong denominator whenever the two run in different rhythms: a monthly
    // bundle booked on a yearly plan was charged a fraction of a *year* at a
    // monthly price, which for the maintainer's own example is 160/365 of the
    // monthly price for seven days of service.

    test('the cycle it is charged against ends where the first period does', () => {
        // Plan ends 31.07, monthly bundle booked 21.02 → 21.02–28.02 served,
        // out of the 28 days between 31.01 and 28.02.
        const first = bundleFirstPeriodEnd({
            startedAt: at('2026-02-21'),
            cycle: 'MONTHLY',
            planPeriodEnd: at('2026-07-31'),
            planAnchorDay: 31,
        });
        assert.equal(iso(first), '2026-02-28');
        assert.equal(iso(bundleFirstPeriodStart(first, 'MONTHLY', 31)), '2026-01-31');
    });

    test('a yearly bundle is charged against a year, not a month', () => {
        const first = bundleFirstPeriodEnd({
            startedAt: at('2026-02-21'),
            cycle: 'YEARLY',
            planPeriodEnd: at('2026-07-31'),
            planAnchorDay: 31,
        });
        assert.equal(iso(first), '2026-07-31');
        assert.equal(iso(bundleFirstPeriodStart(first, 'YEARLY', 31)), '2025-07-31');
    });

    test('the anchor survives being walked backwards, the same as forwards', () => {
        // 31.03 back one month is 28.02 — and back again is 31.01, not 28.01.
        // A consumed anchor going backwards would understate every cycle after
        // a short month, the mirror of the drift going forwards.
        const march = at('2026-03-31');
        const february = retreatOneCycle(march, 'MONTHLY', 31);
        assert.equal(iso(february), '2026-02-28');
        assert.equal(iso(retreatOneCycle(february, 'MONTHLY', 31)), '2026-01-31');
    });

    test('stepping back from January lands in December of the year before', () => {
        assert.equal(iso(retreatOneCycle(at('2026-01-15'), 'MONTHLY', 15)), '2025-12-15');
    });

    test('a leap day retreats to the 28th, and forwards again to the 29th', () => {
        // 29.02.2028 back one year is 28.02.2027 — 2027 has no 29th. The anchor
        // is 29, so the step forward gives it back where the month allows.
        const back = retreatOneCycle(at('2028-02-29'), 'YEARLY', 29);
        assert.equal(iso(back), '2027-02-28');
        assert.equal(iso(bundleNextPeriodEnd(back, 'YEARLY', 29)), '2028-02-29');
    });

    test('the start it gives back is the boundary that leads to that end', () => {
        // The property the pro-rata denominator rests on, and it is this one
        // rather than "back then forward is where you started": a forward step
        // CLAMPS, and a clamp destroys what it clamped. From 28.01 on anchor 29
        // the next boundary is 28.02, and 28.02 leads back to 29.01 — the
        // boundary a subscription anchored on the 29th actually had. 28.01 was
        // never one of its boundaries.
        //
        // So the direction that has to hold is forward-of-back, over every
        // legitimate boundary of a year: each day of each month that the anchor
        // resolves to.
        for (let anchor = 1; anchor <= 31; anchor += 1) {
            for (let month = 0; month < 12; month += 1) {
                const daysInMonth = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
                const end = new Date(Date.UTC(2026, month, Math.min(anchor, daysInMonth)));
                const start = retreatOneCycle(end, 'MONTHLY', anchor);
                assert.equal(
                    iso(bundleNextPeriodEnd(start, 'MONTHLY', anchor)),
                    iso(end),
                    `anchor ${anchor}, month ${month + 1}`,
                );
                assert.ok(start < end, `anchor ${anchor}, month ${month + 1}: start before end`);
            }
        }
    });
});

describe('rolling a booking on, period after period', () => {
    // The columns are written at booking; something has to move them. This is
    // the decision half — the consumer's cron does the reading and writing, the
    // same division of labour `computeNextPeriod` already has for the plan.

    const plan = { billingCycle: 'MONTHLY', billingAnchorDay: 31, endsAt: null };
    const active = {
        currentPeriodEnd: at('2026-02-28'),
        billingCycle: 'MONTHLY',
        canceledAt: null,
        canceledEffectiveAt: null,
    };
    const roll = (booking, planCtx, now) =>
        computeNextBundlePeriod({ ...active, ...booking }, { ...plan, ...planCtx }, now);

    test('a period that is over opens the next one, on the anchor', () => {
        const next = roll({}, {}, at('2026-03-01'));
        assert.equal(iso(next.currentPeriodStart), '2026-02-28');
        // The anchor, not the day of the previous end: 31 March, not 28 March.
        assert.equal(iso(next.currentPeriodEnd), '2026-03-31');
    });

    test('a period still running is left alone', () => {
        assert.equal(roll({}, {}, at('2026-02-20')), null);
    });

    test('a booking with no period of its own stays billed with the plan', () => {
        // Written before the columns existed. Inventing a window here would
        // start billing it a second time.
        assert.equal(roll({ currentPeriodEnd: null }, {}, at('2026-03-01')), null);
    });

    test('a landed cancellation of the booking stops it; a declared one does not', () => {
        assert.equal(roll({ canceledEffectiveAt: at('2026-02-28') }, {}, at('2026-03-01')), null);
        // Declared for a date still ahead: the booking runs and is billed.
        const stillRunning = roll(
            { canceledAt: at('2026-02-01'), canceledEffectiveAt: at('2026-03-31') },
            {},
            at('2026-03-01'),
        );
        assert.equal(iso(stillRunning.currentPeriodEnd), '2026-03-31');
    });

    test('a plan that has ended takes the booking with it, without a cancellation', () => {
        assert.equal(roll({}, { endsAt: at('2026-02-28') }, at('2026-03-01')), null);
    });

    test('a plan ending inside the new period cuts it back rather than outliving it', () => {
        // Only reachable when someone ends the plan off-anchor — the alignment
        // exists so the plan's end is normally a boundary already.
        const next = roll({}, { endsAt: at('2026-03-15') }, at('2026-03-01'));
        assert.equal(iso(next.currentPeriodEnd), '2026-03-15');
    });

    test('a plan ending exactly on the boundary gives the booking that period', () => {
        const next = roll({}, { endsAt: at('2026-03-31') }, at('2026-03-01'));
        assert.equal(iso(next.currentPeriodEnd), '2026-03-31');
        // …and the roll after that one declines, because the plan is over.
        assert.equal(
            roll(
                { currentPeriodEnd: at('2026-03-31') },
                { endsAt: at('2026-03-31') },
                at('2026-04-01'),
            ),
            null,
        );
    });

    test('a booking with no rhythm of its own follows the plan’s', () => {
        const next = roll(
            { billingCycle: null, currentPeriodEnd: at('2026-02-28') },
            { billingCycle: 'YEARLY', billingAnchorDay: 28 },
            at('2026-03-01'),
        );
        assert.equal(iso(next.currentPeriodEnd), '2027-02-28');
    });

    test('a monthly booking beside a yearly plan keeps its own month', () => {
        const next = roll(
            { billingCycle: 'MONTHLY' },
            { billingCycle: 'YEARLY', billingAnchorDay: 31 },
            at('2026-03-01'),
        );
        assert.equal(iso(next.currentPeriodEnd), '2026-03-31');
    });
});

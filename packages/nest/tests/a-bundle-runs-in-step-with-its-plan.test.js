import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    SubscriptionBundlesService,
    bundleCycleFitsPlan,
    bundleFirstPeriodEnd,
    bundleFirstPeriodStart,
    bundleNextPeriodEnd,
    computeNextBundlePeriod,
    resolvePlanAnchorDay,
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

describe('booked anywhere inside a plan period', () => {
    // The first period is short by however much of the plan's period is left,
    // and the three positions where that could go wrong are its ends and its
    // middle. Plan billed on the 21st, period 21.02–21.03.
    const first = (day) =>
        bundleFirstPeriodEnd({
            startedAt: at(day),
            cycle: 'MONTHLY',
            planPeriodEnd: at('2026-03-21'),
            planAnchorDay: 21,
        });

    test('on the first day it runs the whole way to the plan’s next day', () => {
        assert.equal(iso(first('2026-02-21')), '2026-03-21');
    });

    test('in the middle it runs to the same day', () => {
        assert.equal(iso(first('2026-03-05')), '2026-03-21');
    });

    test('on the last day it still gets a period rather than none', () => {
        // 20.03 is the last day inside the window; the boundary is the 21st and
        // has not passed, so one day remains and is charged as one day.
        assert.equal(iso(first('2026-03-20')), '2026-03-21');
    });

    test('a day past the boundary belongs to the next period, not a zero-length one', () => {
        assert.equal(iso(first('2026-03-22')), '2026-04-21');
    });
});

describe('a plan whose periods do not end at midnight', () => {
    // Nothing says a plan's boundaries fall at 00:00 — a subscription started at
    // 14:00 has its periods end at 14:00. Reading the boundary as midnight makes
    // the day of the boundary look spent, so a bundle booked that morning was
    // given the NEXT month and outlived the plan that pays for it.
    const atTime = (s) => new Date(`${s}Z`);
    const first = (startedAt, planPeriodEnd) =>
        bundleFirstPeriodEnd({
            startedAt: atTime(startedAt),
            cycle: 'MONTHLY',
            planPeriodEnd: atTime(planPeriodEnd),
            planAnchorDay: 15,
        });

    test('a booking earlier that day still meets the boundary that day', () => {
        const end = first('2026-02-15T10:00:00.000', '2026-02-15T14:00:00.000');
        assert.equal(end.toISOString(), '2026-02-15T14:00:00.000Z');
    });

    test('a booking after it takes the next month, at the same time of day', () => {
        const end = first('2026-02-15T16:00:00.000', '2026-02-15T14:00:00.000');
        assert.equal(end.toISOString(), '2026-03-15T14:00:00.000Z');
    });

    test('and every period after it keeps that time', () => {
        const end = first('2026-02-15T10:00:00.000', '2026-02-15T14:00:00.000');
        assert.equal(
            bundleNextPeriodEnd(end, 'MONTHLY', 15).toISOString(),
            '2026-03-15T14:00:00.000Z',
        );
    });

    test('the pro-rata denominator keeps it too, so a cycle is a whole cycle', () => {
        const end = first('2026-02-15T10:00:00.000', '2026-02-15T14:00:00.000');
        const start = bundleFirstPeriodStart(end, 'MONTHLY', 15);
        assert.equal(start.toISOString(), '2026-01-15T14:00:00.000Z');
        assert.equal(end.getTime() - start.getTime(), 31 * 86_400_000);
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

    test('a booking billed with the plan is left alone', () => {
        // Written before these columns existed — no window AND no rhythm of its
        // own. Giving it one would start billing it a second time.
        assert.equal(
            roll(
                { currentPeriodEnd: null, billingCycle: null },
                { currentPeriodStart: at('2026-02-28'), currentPeriodEnd: at('2026-03-31') },
                at('2026-03-01'),
            ),
            null,
        );
    });

    test('a booking made before its plan had a period gets one once the plan does', () => {
        // Booked during a trial, or before sales finished: there was nothing to
        // align to, so it was stored without a window. Left unopened, a monthly
        // bundle on a yearly trial kept granting its features and never
        // acquired a window to bill them in.
        const opened = roll(
            { currentPeriodEnd: null, currentPeriodStart: null, billingCycle: 'MONTHLY' },
            {
                billingCycle: 'YEARLY',
                billingAnchorDay: 31,
                currentPeriodStart: at('2026-01-31'),
                currentPeriodEnd: at('2027-01-31'),
            },
            at('2026-02-05'),
        );
        assert.equal(iso(opened.currentPeriodStart), '2026-01-31');
        // Its own month, on the plan's day — not the plan's year.
        assert.equal(iso(opened.currentPeriodEnd), '2026-02-28');
    });

    test('a first window opened late lands after now, not months before it', () => {
        // Booked during a trial in December; the yearly paid period opened on
        // 1 January; nothing ran until April. January to February is a window
        // already over, and the integration writes once per booking per run —
        // so it would stay unbillable for as many runs as were missed.
        const opened = roll(
            { currentPeriodEnd: null, billingCycle: 'MONTHLY' },
            {
                billingCycle: 'YEARLY',
                billingAnchorDay: 1,
                currentPeriodStart: at('2026-01-01'),
                currentPeriodEnd: at('2027-01-01'),
            },
            at('2026-04-10'),
        );
        assert.equal(iso(opened.currentPeriodStart), '2026-01-01');
        assert.equal(iso(opened.currentPeriodEnd), '2026-05-01');
        assert.ok(opened.currentPeriodEnd > at('2026-04-10'), 'the end must be ahead of now');
    });

    test('a first window opened promptly is the short one it should be', () => {
        const opened = roll(
            { currentPeriodEnd: null, billingCycle: 'MONTHLY' },
            {
                billingCycle: 'YEARLY',
                billingAnchorDay: 1,
                currentPeriodStart: at('2026-01-01'),
                currentPeriodEnd: at('2027-01-01'),
            },
            at('2026-01-03'),
        );
        assert.equal(iso(opened.currentPeriodEnd), '2026-02-01');
    });

    test('a booking still waiting keeps waiting while the plan has no period either', () => {
        assert.equal(
            roll(
                { currentPeriodEnd: null, billingCycle: 'MONTHLY' },
                { currentPeriodStart: null, currentPeriodEnd: null },
                at('2026-03-01'),
            ),
            null,
        );
    });

    test('a first window is capped by the plan’s end like any other', () => {
        const opened = roll(
            { currentPeriodEnd: null, billingCycle: 'MONTHLY' },
            {
                billingCycle: 'YEARLY',
                billingAnchorDay: 31,
                currentPeriodStart: at('2026-01-31'),
                currentPeriodEnd: at('2027-01-31'),
                endsAt: at('2026-02-15'),
            },
            at('2026-02-05'),
        );
        assert.equal(iso(opened.currentPeriodEnd), '2026-02-15');
    });

    test('a window that would end at or before it starts is not opened at all', () => {
        // Only reachable for a plan whose own window starts in the future — a
        // subscription that begins next month — and that ends on the day it
        // starts. Without the guard the clamp below would hand back a window
        // ending where it began, which is a period nobody can be billed for.
        assert.equal(
            roll(
                { currentPeriodEnd: null, billingCycle: 'MONTHLY' },
                {
                    billingCycle: 'MONTHLY',
                    billingAnchorDay: 30,
                    currentPeriodStart: at('2026-04-30'),
                    currentPeriodEnd: at('2026-05-30'),
                    endsAt: at('2026-04-30'),
                },
                at('2026-03-01'),
            ),
            null,
        );
    });

    test('every window it does hand back ends after it starts', () => {
        // The invariant the guard above protects, stated where it can fail.
        const cases = [
            [{ currentPeriodEnd: null, billingCycle: 'MONTHLY' }, {}, at('2026-03-01')],
            [{}, {}, at('2026-03-01')],
            [{}, { endsAt: at('2026-03-15') }, at('2026-03-01')],
        ];
        for (const [booking, planCtx, now] of cases) {
            const w = roll(
                booking,
                {
                    currentPeriodStart: at('2026-01-31'),
                    currentPeriodEnd: at('2026-02-28'),
                    ...planCtx,
                },
                now,
            );
            if (w !== null) {
                assert.ok(
                    w.currentPeriodEnd > w.currentPeriodStart,
                    `${iso(w.currentPeriodStart)} → ${iso(w.currentPeriodEnd)}`,
                );
            }
        }
    });

    test('a job that missed months catches up in one go', () => {
        // Not one cycle on: the integration writes once per booking per run, so
        // advancing by a single cycle would hand back a window that ended two
        // months ago and need as many runs as were missed to catch up. The plan
        // has always jumped; a bundle that did not would drift away from the
        // plan it runs in step with.
        const next = roll({ currentPeriodEnd: at('2026-02-28') }, {}, at('2026-06-05'));
        assert.equal(iso(next.currentPeriodStart), '2026-02-28');
        assert.equal(iso(next.currentPeriodEnd), '2026-06-30');
        assert.ok(next.currentPeriodEnd > at('2026-06-05'), 'the new end must be in the future');
    });

    test('catching up keeps the anchor rather than losing it to a short month', () => {
        // Anchor 31, four months missed across a February: the boundary it
        // lands on is the 31st, not the 28th a clamped step would carry on.
        const next = roll({ currentPeriodEnd: at('2026-01-31') }, {}, at('2026-05-10'));
        assert.equal(iso(next.currentPeriodEnd), '2026-05-31');
    });

    test('a declared cancellation caps the window it opens', () => {
        // Declared inside a minimum term, so it lands on a date measured from
        // the booking while periods land on the plan's anchor — the two rarely
        // coincide, and a whole cycle past that date is service the cancel API
        // promised would not be billed.
        const next = roll(
            { currentPeriodEnd: at('2026-02-28'), canceledEffectiveAt: at('2026-03-15') },
            {},
            at('2026-03-01'),
        );
        assert.equal(iso(next.currentPeriodEnd), '2026-03-15');
    });

    test('a declared cancellation already passed opens nothing at all', () => {
        assert.equal(
            roll(
                { currentPeriodEnd: at('2026-02-28'), canceledEffectiveAt: at('2026-02-28') },
                {},
                at('2026-03-01'),
            ),
            null,
        );
    });

    test('whichever ends first wins — the plan or the booking', () => {
        const bookingFirst = roll(
            { currentPeriodEnd: at('2026-02-28'), canceledEffectiveAt: at('2026-03-10') },
            { endsAt: at('2026-03-20') },
            at('2026-03-01'),
        );
        assert.equal(iso(bookingFirst.currentPeriodEnd), '2026-03-10');

        const planFirst = roll(
            { currentPeriodEnd: at('2026-02-28'), canceledEffectiveAt: at('2026-03-20') },
            { endsAt: at('2026-03-10') },
            at('2026-03-01'),
        );
        assert.equal(iso(planFirst.currentPeriodEnd), '2026-03-10');
    });

    test('a first window is capped by a declared cancellation too', () => {
        const opened = roll(
            {
                currentPeriodEnd: null,
                billingCycle: 'MONTHLY',
                canceledEffectiveAt: at('2026-02-10'),
            },
            {
                billingCycle: 'YEARLY',
                billingAnchorDay: 31,
                currentPeriodStart: at('2026-01-31'),
                currentPeriodEnd: at('2027-01-31'),
            },
            at('2026-02-05'),
        );
        assert.equal(iso(opened.currentPeriodEnd), '2026-02-10');
    });

    test('a cancelled booking is not given a first window either', () => {
        assert.equal(
            roll(
                {
                    currentPeriodEnd: null,
                    billingCycle: 'MONTHLY',
                    canceledEffectiveAt: at('2026-02-01'),
                },
                { currentPeriodStart: at('2026-01-31'), currentPeriodEnd: at('2027-01-31') },
                at('2026-02-05'),
            ),
            null,
        );
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

describe('cancelling one, against its own period', () => {
    // A cancellation takes effect at the end of the period being paid for. For
    // a monthly bundle beside a yearly plan those are months apart, and reading
    // the plan's boundary kept the booking committed — and billed — until the
    // annual renewal, for up to eleven months the tenant never asked for.

    function serviceFor(booking) {
        const cancelled = [];
        const svc = new SubscriptionBundlesService(
            {
                add: async (data) => ({ id: 'sb-1', ...data }),
                listBySubscription: async () => [],
                listActiveBySubscription: async () => [],
                findById: async () => booking,
                cancel: async (id, patch) => {
                    cancelled.push(patch);
                    return { ...booking, ...patch };
                },
            },
            { findVersionById: async () => null },
            { defaultMinimumTermMonths: 0 },
        );
        return { svc, cancelled };
    }

    const monthlyBookingOnYearlyPlan = {
        id: 'sb-1',
        subscriptionId: 'sub-1',
        bundleVersionId: 'bv-1',
        minimumTermEndsAt: null,
        billingCycle: 'MONTHLY',
        currentPeriodStart: at('2026-02-28'),
        currentPeriodEnd: at('2026-03-31'),
        canceledAt: null,
        canceledEffectiveAt: null,
    };

    test('a monthly booking ends with its month, not with the plan’s year', async () => {
        const { svc } = serviceFor(monthlyBookingOnYearlyPlan);
        const result = await svc.cancelBundleFromSubscription({
            subscriptionBundleId: 'sb-1',
            canceledAt: at('2026-03-05'),
            // What the plan would have said: eleven months later.
            currentPeriodEnd: at('2027-01-01'),
            parentEndsAt: null,
        });
        assert.equal(iso(result.canceledEffectiveAt), '2026-03-31');
    });

    test('a booking from before the columns existed still ends with the plan', async () => {
        // It was billed with the plan, so the plan's boundary is the period it
        // is paying for. Reading null as "ends now" would end it mid-period.
        const { svc } = serviceFor({
            ...monthlyBookingOnYearlyPlan,
            billingCycle: null,
            currentPeriodStart: null,
            currentPeriodEnd: null,
        });
        const result = await svc.cancelBundleFromSubscription({
            subscriptionBundleId: 'sb-1',
            canceledAt: at('2026-03-05'),
            currentPeriodEnd: at('2027-01-01'),
            parentEndsAt: null,
        });
        assert.equal(iso(result.canceledEffectiveAt), '2027-01-01');
    });

    test('a minimum term still outranks the period when it runs longer', async () => {
        const { svc } = serviceFor({
            ...monthlyBookingOnYearlyPlan,
            minimumTermEndsAt: at('2026-08-31'),
        });
        const result = await svc.cancelBundleFromSubscription({
            subscriptionBundleId: 'sb-1',
            canceledAt: at('2026-03-05'),
            currentPeriodEnd: at('2027-01-01'),
            parentEndsAt: null,
        });
        assert.equal(iso(result.canceledEffectiveAt), '2026-08-31');
    });

    test('and the parent’s end still caps both', async () => {
        const { svc } = serviceFor({
            ...monthlyBookingOnYearlyPlan,
            minimumTermEndsAt: at('2026-08-31'),
        });
        const result = await svc.cancelBundleFromSubscription({
            subscriptionBundleId: 'sb-1',
            canceledAt: at('2026-03-05'),
            currentPeriodEnd: at('2027-01-01'),
            parentEndsAt: at('2026-05-31'),
        });
        assert.equal(iso(result.canceledEffectiveAt), '2026-05-31');
    });
});

describe('one answer for the plan’s billing day', () => {
    // The field that decides whether a preview and a booking describe the same
    // contract. Resolved in one place so they cannot disagree — they did: the
    // preview read the window start and the booking left it null, so the
    // arithmetic read the window END, and for a 31 January to 28 February
    // window one said the 31st and the other the 28th.

    test('a stored anchor is the answer', () => {
        assert.equal(
            resolvePlanAnchorDay({
                billingAnchorDay: 31,
                currentPeriodStart: at('2026-01-31'),
                startedAt: at('2025-06-08'),
            }),
            31,
        );
    });

    test('without one, the day that opened the window — never the day that closed it', () => {
        assert.equal(
            resolvePlanAnchorDay({
                billingAnchorDay: null,
                currentPeriodStart: at('2026-01-31'),
                startedAt: at('2025-06-08'),
            }),
            31,
        );
    });

    test('without a window either, the day the subscription started', () => {
        assert.equal(
            resolvePlanAnchorDay({ billingAnchorDay: null, startedAt: at('2025-06-08') }),
            8,
        );
    });

    test('with nothing at all it says so, rather than inventing a day', () => {
        assert.equal(resolvePlanAnchorDay({}), null);
    });

    test('a value that cannot be a day of a month is treated as absent', () => {
        // Zero is what an EXTRACT over a missing date leaves behind, and day 0
        // of a month is the last day of the month before it — a boundary that
        // moves backwards.
        for (const stored of [0, -1, 32, 1.5, Number.NaN]) {
            assert.equal(
                resolvePlanAnchorDay({
                    billingAnchorDay: stored,
                    currentPeriodStart: at('2026-01-31'),
                }),
                31,
                `stored ${stored}`,
            );
        }
    });

    test('the preview and the booking reach the same day for the same subscription', () => {
        // The property that matters, stated directly: one resolver, one answer.
        const sub = {
            billingAnchorDay: null,
            currentPeriodStart: at('2026-01-31'),
            currentPeriodEnd: at('2026-02-28'),
            startedAt: at('2025-12-31'),
        };
        const anchor = resolvePlanAnchorDay(sub);
        assert.equal(anchor, 31);
        assert.equal(
            iso(
                bundleFirstPeriodEnd({
                    startedAt: at('2026-02-17'),
                    cycle: 'MONTHLY',
                    planPeriodEnd: sub.currentPeriodEnd,
                    planAnchorDay: anchor,
                }),
            ),
            '2026-02-28',
        );
        // …and the period after it lands on the 31st, which is the half a
        // clamped anchor would have lost.
        assert.equal(iso(bundleNextPeriodEnd(at('2026-02-28'), 'MONTHLY', anchor)), '2026-03-31');
    });
});

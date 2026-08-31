import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    advanceOneCycle,
    computeNextPeriod,
    decideCancellationFor,
    initialPeriodWindow,
    periodEndAfter,
} from '../dist/billing/index.js';

// A subscription is billed on a day of the month, and February must not take it
// away for good.
//
// The arithmetic used to read that day from its own input, and its own input
// was the previous result — which had already been clamped to fit a shorter
// month. So a subscription starting on the 31st was billed on the 28th in
// February and on the 28th ever after: three days lost once, silently, and
// every later date measured from the wrong one. The renewal window, the notice
// deadline and the contract end a customer is told about all hang off it.
//
// The rule the maintainer settled: the anchor is a DAY NUMBER, clamped down
// where the month is too short, and never consumed by that clamp. Anchor 31
// gives 28 February and then 31 March. Anchor 30 gives 30 October, not 31 —
// "the 30th", not "the end of the month".

const iso = (d) => d.toISOString().slice(0, 10);

/** Walks `steps` periods from `from`, the way a renewal cron does. */
function walk(from, cycle, steps, anchorDay) {
    const seen = [];
    let at = new Date(from);
    for (let i = 0; i < steps; i += 1) {
        at = advanceOneCycle(at, cycle, anchorDay);
        seen.push(iso(at));
    }
    return seen;
}

// @requirement SC-SUB-004 — A short month does not move the billing day
describe('a subscription billed on the 31st', () => {
    const anchor = 31;

    test('comes back to the 31st after February', () => {
        const months = walk('2026-01-31T00:00:00.000Z', 'MONTHLY', 4, anchor);

        assert.deepEqual(months, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    });

    test('and without an anchor it never comes back — the case this exists for', () => {
        // The old reading, kept reachable so the defect stays legible: each
        // step takes its day from the previous clamped result.
        const months = walk('2026-01-31T00:00:00.000Z', 'MONTHLY', 4, undefined);

        assert.deepEqual(months, ['2026-02-28', '2026-03-28', '2026-04-28', '2026-05-28']);
    });
});

// @requirement SC-SUB-004 — A short month does not move the billing day
describe('a subscription billed on the 30th', () => {
    // The distinction the maintainer drew: an anchor is a day number, not "the
    // end of the month". Both readings agree on the 31st and part company here.
    test('is billed on the 30th in a 31-day month', () => {
        const months = walk('2026-09-30T00:00:00.000Z', 'MONTHLY', 3, 30);

        assert.deepEqual(months, ['2026-10-30', '2026-11-30', '2026-12-30']);
    });

    test('and on the 28th in February, then back to the 30th', () => {
        const months = walk('2027-01-30T00:00:00.000Z', 'MONTHLY', 2, 30);

        assert.deepEqual(months, ['2027-02-28', '2027-03-30']);
    });
});

// @requirement SC-SUB-004 — A short month does not move the billing day
describe('a yearly subscription starting on a leap day', () => {
    test('is billed on the 28th in ordinary years and the 29th when one comes round', () => {
        const years = walk('2028-02-29T00:00:00.000Z', 'YEARLY', 4, 29);

        assert.deepEqual(years, ['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    });
});

// @requirement SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal
describe('iterating to the next boundary', () => {
    test('keeps the anchor across every step it takes', () => {
        // `periodEndAfter` is where a renewal asks "when is the next one", and
        // it iterates — so it is where an anchor is lost if it is not carried.
        const end = periodEndAfter(
            new Date('2026-01-31T00:00:00.000Z'),
            'MONTHLY',
            new Date('2026-04-15T00:00:00.000Z'),
        );

        assert.equal(iso(end), '2026-04-30');
    });

    test('and reaches the anchor day itself where the month is long enough', () => {
        const end = periodEndAfter(
            new Date('2026-01-31T00:00:00.000Z'),
            'MONTHLY',
            new Date('2026-05-01T00:00:00.000Z'),
        );

        assert.equal(iso(end), '2026-05-31');
    });

    test('and an explicit anchor overrides the start it was given', () => {
        // A window reopened by a plan change starts on a new day, and the
        // caller says so rather than the function guessing from `startedAt`.
        const end = periodEndAfter(
            new Date('2026-01-31T00:00:00.000Z'),
            'MONTHLY',
            new Date('2026-03-05T00:00:00.000Z'),
            15,
        );

        assert.equal(iso(end), '2026-03-15');
    });
});

// @requirement SC-SUB-004 — A short month does not move the billing day
// @requirement SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal
describe('a renewal that has already been through a February', () => {
    // Where the anchor is actually lost in production: the roll takes the new
    // window from the previous period END, and that end has been clamped. Each
    // renewal then measures from the clamped value, so one short month sets the
    // billing day for the rest of the subscription.
    const rollFrom = (currentPeriodEnd, billingAnchorDay) =>
        computeNextPeriod(
            {
                currentPeriodEnd: new Date(currentPeriodEnd),
                billingCycle: 'MONTHLY',
                canceledAt: null,
                canceledEffectiveAt: null,
                billingAnchorDay,
            },
            new Date('2026-03-01T12:00:00.000Z'),
        );

    test('rolls back onto the day the customer is billed on', () => {
        const next = rollFrom('2026-02-28T00:00:00.000Z', 31);

        assert.equal(next.currentPeriodEnd.toISOString().slice(0, 10), '2026-03-31');
    });

    test('and without a stored anchor keeps the day it landed on', () => {
        // The fallback, stated rather than assumed: a row written before the
        // column exists behaves exactly as it did, which is what makes the
        // migration additive.
        const next = rollFrom('2026-02-28T00:00:00.000Z', null);

        assert.equal(next.currentPeriodEnd.toISOString().slice(0, 10), '2026-03-28');
    });
});

// @requirement SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal
describe('a subscription billed on an ordinary day', () => {
    // The premise for every clamp above: most subscriptions never meet one, and
    // the anchor must not move them either.
    test('is billed on that day in every month, long or short', () => {
        const months = walk('2026-01-15T00:00:00.000Z', 'MONTHLY', 4, 15);

        assert.deepEqual(months, ['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15']);
    });

    test('and the first of the month is not confused with the last of the one before', () => {
        // Day 0 is a real date in JavaScript and it is the previous month's
        // last day, so the boundary between "1" and "0" is worth pinning.
        const months = walk('2026-01-01T00:00:00.000Z', 'MONTHLY', 3, 1);

        assert.deepEqual(months, ['2026-02-01', '2026-03-01', '2026-04-01']);
    });
});

// @requirement SC-SUB-004 — A short month does not move the billing day
describe('a yearly subscription billed on the 31st', () => {
    test('stays on the 31st, because the month is the same one every year', () => {
        const years = walk('2026-01-31T00:00:00.000Z', 'YEARLY', 3, 31);

        assert.deepEqual(years, ['2027-01-31', '2028-01-31', '2029-01-31']);
    });
});

// @requirement SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal
// @requirement SC-CHG-003 — An immediate upgrade extends the running term, it does not restart it
describe('a plan change reopens the window', () => {
    test('and the day the customer is billed on moves with it', () => {
        // A change on the 5th makes the 5th the billing day. The window that
        // opens is the anchor — which is why the platform derives it from
        // `periodStart` rather than carrying a second field that could differ.
        const window = initialPeriodWindow(new Date('2026-03-05T00:00:00.000Z'), 'MONTHLY');

        assert.equal(iso(window.start), '2026-03-05');
        assert.equal(iso(window.end), '2026-04-05');
        assert.equal(window.start.getUTCDate(), 5);
    });
});

// @requirement SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal
describe('an anchor that cannot be a day of a month', () => {
    // The column is a plain nullable integer, and a consumer's own backfill
    // fills it. Zero is what an `EXTRACT` over a missing date can leave behind.
    //
    // Unguarded this was not a rounding error: `Math.min(0, 31)` is 0, day 0 of
    // a month is the LAST DAY OF THE MONTH BEFORE it, and the boundary moved
    // backwards — a subscription whose next period ended before its current one
    // did.
    const from = '2026-03-15T00:00:00.000Z';

    for (const impossible of [0, -3, 32, 1.5, Number.NaN]) {
        test(`${impossible} is treated as absent, not as a day`, () => {
            const [next] = walk(from, 'MONTHLY', 1, impossible);

            assert.equal(next, '2026-04-15', 'the boundary moved somewhere it should not');
        });
    }

    test('while a possible one is used', () => {
        // The premise: the guard rejects impossible values, not all values.
        const [next] = walk(from, 'MONTHLY', 1, 3);

        assert.equal(next, '2026-04-03');
    });
});

// @requirement SC-CANC-009 — A missed notice deadline moves the cancellation to the end of the next period
describe('a cancellation that arrives after the notice window', () => {
    // The hard cut lands one period past the term end, and that step used to
    // take its day from the term end alone. After a February the term end has
    // already been clamped, so an anchor-31 subscription was cut to 28 March
    // rather than 31 March — three days short of the period the customer had
    // just been charged for. The one place the anchor costs money if it is
    // missing.
    const termEnd = new Date('2026-02-28T00:00:00.000Z');
    const afterTheDeadline = new Date('2026-02-25T00:00:00.000Z');

    const lateCancel = (billingAnchorDay) =>
        decideCancellationFor(
            {
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                currentPeriodEnd: termEnd,
                minimumTermUntil: termEnd,
                trialEndsAt: null,
                billingAnchorDay,
            },
            afterTheDeadline,
            14,
        );

    test('buys the period the customer is billed for, to its day', () => {
        const decision = lateCancel(31);

        assert.equal(decision.afterNoticeDeadline, true, 'the case under test did not arise');
        assert.equal(iso(decision.effectiveAt), '2026-03-31');
    });

    test('and without a stored anchor keeps the old, shorter answer', () => {
        // Stated rather than hidden: an adapter that does not carry the column
        // behaves exactly as it did, which is what makes the column additive.
        assert.equal(iso(lateCancel(null).effectiveAt), '2026-03-28');
    });

    test('while an on-time cancellation does not reach the step at all', () => {
        // The premise: the anchor matters to the hard cut and to nothing else
        // in this decision.
        const decision = decideCancellationFor(
            {
                status: 'ACTIVE',
                billingCycle: 'MONTHLY',
                currentPeriodEnd: termEnd,
                minimumTermUntil: termEnd,
                trialEndsAt: null,
                billingAnchorDay: 31,
            },
            new Date('2026-02-01T00:00:00.000Z'),
            14,
        );

        assert.equal(decision.afterNoticeDeadline, false);
        assert.equal(iso(decision.effectiveAt), '2026-02-28');
    });
});

// @requirement SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal
describe('an impossible anchor handed to the iteration', () => {
    // Normalising inside each step is not enough: `??` keeps a zero, and a zero
    // passed down is rejected by every step individually — each then falling
    // back to ITS OWN candidate's day, which is exactly the drift the anchor
    // removes. It has to be normalised once, where it enters.
    test('is treated as absent for the whole walk, not for each step', () => {
        const withZero = periodEndAfter(
            new Date('2026-01-31T00:00:00.000Z'),
            'MONTHLY',
            new Date('2026-03-05T00:00:00.000Z'),
            0,
        );
        const withNone = periodEndAfter(
            new Date('2026-01-31T00:00:00.000Z'),
            'MONTHLY',
            new Date('2026-03-05T00:00:00.000Z'),
        );

        assert.equal(iso(withZero), iso(withNone));
        assert.equal(iso(withZero), '2026-03-31');
    });
});

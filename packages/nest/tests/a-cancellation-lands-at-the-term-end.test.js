import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    advanceOneCycle,
    decideCancellation,
    decideCancellationFor,
} from '../dist/billing/index.js';

// Declaring a cancellation is never refused; the rules decide the date.
//
// Three facts feed that date: the minimum term committed to at activation, the
// notice period an installation may configure, and whether the declaration
// arrived before that window closed. The default notice period is zero, which
// makes the third fact impossible — most installations should leave it there.
//
// The case worth reading twice is the hard cut. A yearly term ending on
// 1 Jan 2027 with a fourteen-day window: a cancellation on 20 Dec 2026 lands on
// 1 Jan 2027, one on 24 Dec 2026 lands on 1 Jan 2028. Four days of difference,
// a year of consequence — which is why the page has to say which period it
// falls into before the customer confirms.

const YEAR_END = new Date('2027-01-01T00:00:00.000Z');

const base = (overrides = {}) => ({
    now: new Date('2026-06-01T00:00:00.000Z'),
    currentPeriodEnd: YEAR_END,
    minimumTermUntil: YEAR_END,
    billingCycle: 'YEARLY',
    noticePeriodDays: 0,
    ...overrides,
});

describe('with no notice period, which is the default', () => {
    test('a cancellation lands at the end of the term', () => {
        const decision = decideCancellation(base());
        assert.deepEqual(decision.effectiveAt, YEAR_END);
        assert.equal(decision.afterNoticeDeadline, false);
        assert.equal(decision.noticeDeadline, null);
    });

    test('the last day of the term is still in time', () => {
        // The whole point of the default: there is no door to be shut out of.
        const decision = decideCancellation(base({ now: new Date('2026-12-31T23:00:00.000Z') }));
        assert.deepEqual(decision.effectiveAt, YEAR_END);
        assert.equal(decision.afterNoticeDeadline, false);
    });
});

describe('with a notice period configured', () => {
    const withNotice = (now) => decideCancellation(base({ now, noticePeriodDays: 14 }));

    test('before the window closes, nothing changes', () => {
        const decision = withNotice(new Date('2026-12-17T00:00:00.000Z'));
        assert.deepEqual(decision.effectiveAt, YEAR_END);
        assert.equal(decision.afterNoticeDeadline, false);
        assert.deepEqual(decision.noticeDeadline, new Date('2026-12-18T00:00:00.000Z'));
    });

    test('on the deadline itself, still in time', () => {
        // A boundary decided deliberately rather than by whichever comparison
        // got written first: the deadline is the last moment that counts.
        const decision = withNotice(new Date('2026-12-18T00:00:00.000Z'));
        assert.deepEqual(decision.effectiveAt, YEAR_END);
        assert.equal(decision.afterNoticeDeadline, false);
    });

    test('one second later, a whole period later', () => {
        const decision = withNotice(new Date('2026-12-18T00:00:01.000Z'));
        assert.deepEqual(decision.effectiveAt, new Date('2028-01-01T00:00:00.000Z'));
        assert.equal(decision.afterNoticeDeadline, true);
    });

    test('a monthly term moves by a month, not by a year', () => {
        const monthEnd = new Date('2026-07-01T00:00:00.000Z');
        const decision = decideCancellation({
            now: new Date('2026-06-25T00:00:00.000Z'),
            currentPeriodEnd: monthEnd,
            minimumTermUntil: monthEnd,
            billingCycle: 'MONTHLY',
            noticePeriodDays: 14,
        });
        assert.equal(decision.afterNoticeDeadline, true);
        assert.deepEqual(decision.effectiveAt, new Date('2026-08-01T00:00:00.000Z'));
    });
});

describe('when the term and the period disagree', () => {
    test('the later of the two decides', () => {
        // They part company once a notice period has pushed a term past the
        // period it started in. Taking the period end alone would let a
        // customer out of a commitment they are still inside.
        const decision = decideCancellation(
            base({ currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z') }),
        );
        assert.deepEqual(decision.termEndsAt, YEAR_END);
        assert.deepEqual(decision.effectiveAt, YEAR_END);
    });

    test('a subscription with no term at all falls back to the period', () => {
        const decision = decideCancellation(base({ minimumTermUntil: null }));
        assert.deepEqual(decision.effectiveAt, YEAR_END);
    });
});

describe('when nothing is left to run', () => {
    test('a term already past lands the cancellation now', () => {
        // Deferring to a date in the past would report something the reader has
        // to reason about backwards.
        const now = new Date('2027-06-01T00:00:00.000Z');
        const decision = decideCancellation(base({ now }));
        assert.deepEqual(decision.effectiveAt, now);
        assert.equal(decision.afterNoticeDeadline, false);
    });

    test('no dates at all is the same answer', () => {
        const now = new Date('2026-06-01T00:00:00.000Z');
        const decision = decideCancellation(
            base({ now, currentPeriodEnd: null, minimumTermUntil: null }),
        );
        assert.deepEqual(decision.effectiveAt, now);
    });
});

describe('a period boundary on a month end stays on a month end', () => {
    // `setUTCMonth` does not clamp, it overflows: 31 January plus one month is
    // 3 March. Pre-existing, and invisible while the result was only a period
    // boundary — a cancellation now reports it to a customer as the day their
    // contract ends, and "3 March" for a contract that started on 31 January
    // is the kind of date somebody disputes.
    const advance = (iso, cycle) =>
        advanceOneCycle(new Date(iso), cycle).toISOString().slice(0, 10);

    test('31 January plus a month is the end of February', () => {
        assert.equal(advance('2026-01-31T00:00:00.000Z', 'MONTHLY'), '2026-02-28');
    });

    test('and in a leap year, the 29th', () => {
        assert.equal(advance('2028-01-31T00:00:00.000Z', 'MONTHLY'), '2028-02-29');
    });

    test('31 March plus a month is 30 April', () => {
        assert.equal(advance('2026-03-31T00:00:00.000Z', 'MONTHLY'), '2026-04-30');
    });

    test('29 February plus a year is 28 February', () => {
        assert.equal(advance('2028-02-29T00:00:00.000Z', 'YEARLY'), '2029-02-28');
    });

    test('a day that exists in both months is untouched', () => {
        // The clamp must not move a date that needed no moving.
        assert.equal(advance('2026-01-15T00:00:00.000Z', 'MONTHLY'), '2026-02-15');
    });

    test('December rolls into the next year', () => {
        // The month arithmetic crosses the year boundary; `Date.UTC` with month
        // 12 is January of the next year, which is what makes the day count
        // right rather than accidentally right.
        assert.equal(advance('2026-12-31T00:00:00.000Z', 'MONTHLY'), '2027-01-31');
    });
});

describe('a trial has an end, not a term', () => {
    // A trial has a period end like every other subscription — the visual
    // fixture in this repository sets one — and reading it as a term makes the
    // two rules a customer meets disagree with each other: a plan change during
    // a trial takes effect at once because there is nothing to protect, while a
    // cancellation was measured against a commitment that does not exist.
    const DAY = 86_400_000;
    const trialEnds = new Date('2026-06-06T00:00:00.000Z');
    const trial = (overrides = {}) => ({
        status: 'TRIAL',
        billingCycle: 'YEARLY',
        currentPeriodEnd: trialEnds,
        minimumTermUntil: null,
        trialEndsAt: trialEnds,
        ...overrides,
    });
    const now = new Date(trialEnds.getTime() - 5 * DAY);

    test('the cancellation lands when the trial does', () => {
        const decision = decideCancellationFor(trial(), now, 0);
        assert.deepEqual(decision.effectiveAt, trialEnds);
    });

    test('a notice period does not buy a billing cycle', () => {
        // Five days from the end with a fortnight's notice: for a term this is
        // past the deadline and lands a period later. A customer ending a
        // yearly-cycle trial would have bought a year by cancelling it.
        const decision = decideCancellationFor(trial(), now, 14);
        assert.deepEqual(decision.effectiveAt, trialEnds);
        assert.equal(decision.afterNoticeDeadline, false);
        assert.equal(decision.noticeDeadline, null);
    });

    test('and a paid term five days out still does', () => {
        // The premise: the exemption is the trial, not the arithmetic.
        const decision = decideCancellationFor(trial({ status: 'ACTIVE' }), now, 14);
        assert.deepEqual(decision.effectiveAt, advanceOneCycle(trialEnds, 'YEARLY'));
        assert.equal(decision.afterNoticeDeadline, true);
    });

    test('a trial with no dates at all still lands now', () => {
        const decision = decideCancellationFor(
            trial({ currentPeriodEnd: null, trialEndsAt: null }),
            now,
            14,
        );
        assert.deepEqual(decision.effectiveAt, now);
    });
});

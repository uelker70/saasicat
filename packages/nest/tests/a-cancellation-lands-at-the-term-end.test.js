import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { decideCancellation } from '../dist/billing/index.js';

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

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { decideCancellation, noticeDaysFor } from '../dist/billing/index.js';

// How long a customer waits after saying they want out.
//
// One number governed both rhythms until 2026-08-27, and it could not be right
// for both: a fortnight of notice on a yearly contract is unusual, three months
// on a monthly one is void against a consumer. Worse, a notice longer than the
// period made every declaration "late" — the deadline it computed had always
// passed — and the remedy it applied was one period, which is less notice than
// was promised.
//
// Measured before the change, monthly cycle, period ending 31 March, 60 days of
// notice: declaring on the 1st gave 60 days, on the 15th gave 46, on the 30th
// gave 31. The operator had promised 60 in all three.

const DAY = 86_400_000;
const at = (s) => new Date(`${s}T00:00:00.000Z`);

const decide = (declaredOn, noticePeriodDays, overrides = {}) =>
    decideCancellation({
        now: at(declaredOn),
        currentPeriodEnd: at('2026-03-31'),
        minimumTermUntil: null,
        billingCycle: 'MONTHLY',
        noticePeriodDays,
        billingAnchorDay: 31,
        ...overrides,
    });

const daysBetween = (from, to) => Math.round((to.getTime() - at(from).getTime()) / DAY);

describe('a notice longer than the period is served, not approximated', () => {
    // The three rows of the measurement, and the promise each has to keep.
    for (const declaredOn of ['2026-03-01', '2026-03-15', '2026-03-30']) {
        test(`declaring on ${declaredOn} still buys 60 days`, () => {
            const decision = decide(declaredOn, 60);
            assert.ok(
                daysBetween(declaredOn, decision.effectiveAt) >= 60,
                `only ${daysBetween(declaredOn, decision.effectiveAt)} days of notice were served`,
            );
        });
    }

    test('and it lands on a billing boundary, not sixty days from today', () => {
        // The notice is a floor, not the date itself: a subscription ends where
        // its periods end, so the customer is never billed for part of one.
        const decision = decide('2026-03-30', 60);
        assert.equal(decision.effectiveAt.toISOString().slice(0, 10), '2026-05-31');
    });

    test('the anchor survives the extra steps', () => {
        // Two steps across a short month. An anchor consumed on the way would
        // cut the customer short of a period they were charged for.
        const decision = decide('2026-01-30', 60, {
            currentPeriodEnd: at('2026-01-31'),
            billingAnchorDay: 31,
        });
        assert.equal(decision.effectiveAt.toISOString().slice(0, 10), '2026-03-31');
    });
});

describe('a notice shorter than the period behaves as it always did', () => {
    test('declared in time, it ends with the period', () => {
        const decision = decide('2026-03-01', 14);
        assert.equal(decision.afterNoticeDeadline, false);
        assert.equal(decision.effectiveAt.toISOString().slice(0, 10), '2026-03-31');
    });

    test('declared too late, it ends one period on — which already serves it', () => {
        const decision = decide('2026-03-25', 14);
        assert.equal(decision.afterNoticeDeadline, true);
        assert.equal(decision.effectiveAt.toISOString().slice(0, 10), '2026-04-30');
        assert.ok(daysBetween('2026-03-25', decision.effectiveAt) >= 14);
    });

    test('the deadline is a real date, reachable by declaring earlier', () => {
        // With a notice longer than the period this was always in the past, so
        // "you missed the deadline" reached every customer, always — and a
        // warning that never stays silent is one nobody reads.
        const decision = decide('2026-03-01', 14);
        assert.ok(decision.noticeDeadline);
        assert.ok(decision.noticeDeadline > at('2026-03-01'));
    });

    test('no notice at all ends with the period, whenever it is declared', () => {
        for (const declaredOn of ['2026-03-01', '2026-03-30']) {
            const decision = decide(declaredOn, 0);
            assert.equal(decision.effectiveAt.toISOString().slice(0, 10), '2026-03-31');
            assert.equal(decision.afterNoticeDeadline, false);
            assert.equal(decision.noticeDeadline, null);
        }
    });

    test('a term already over ends now, not at a date in the past', () => {
        const decision = decide('2026-04-05', 14);
        assert.equal(decision.effectiveAt.toISOString().slice(0, 10), '2026-04-05');
    });
});

describe('a year of notice on a yearly contract', () => {
    test('is served by one step, because a year of period covers it', () => {
        const decision = decideCancellation({
            now: at('2026-11-01'),
            currentPeriodEnd: at('2026-12-31'),
            minimumTermUntil: null,
            billingCycle: 'YEARLY',
            noticePeriodDays: 90,
            billingAnchorDay: 31,
        });
        assert.equal(decision.effectiveAt.toISOString().slice(0, 10), '2027-12-31');
        assert.ok(daysBetween('2026-11-01', decision.effectiveAt) >= 90);
    });
});

describe('which of the two numbers applies', () => {
    // The rhythm of the contract decides, not of the plan somebody is looking
    // at: the same plan may be sold both ways.
    const periods = { monthly: 14, yearly: 90 };

    test('a monthly subscription is owed the monthly notice', () => {
        assert.equal(noticeDaysFor(periods, 'MONTHLY'), 14);
    });

    test('a yearly subscription is owed the yearly notice', () => {
        assert.equal(noticeDaysFor(periods, 'YEARLY'), 90);
    });

    test('a rhythm nobody configured is owed nothing', () => {
        // Not the other one: a configuration that names only one has left the
        // other at zero deliberately, and inferring it would invent a term.
        assert.equal(noticeDaysFor({ yearly: 90 }, 'MONTHLY'), 0);
        assert.equal(noticeDaysFor({ monthly: 14 }, 'YEARLY'), 0);
    });

    test('no configuration at all is no notice', () => {
        assert.equal(noticeDaysFor(undefined, 'MONTHLY'), 0);
        assert.equal(noticeDaysFor({}, 'YEARLY'), 0);
    });

    test('an explicit zero is a zero, not an absence', () => {
        assert.equal(noticeDaysFor({ monthly: 0, yearly: 90 }, 'MONTHLY'), 0);
    });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { calendarMonthsAfter, retirementReach } from '../dist/billing/index.js';

// When a retirement takes effect for a subscription: the first end of one of its
// terms at least three calendar months after the announcement. The three
// worked examples are the ones #357 states, announced on 15 March.

const at = (instant) => new Date(instant);
const ANNOUNCED = at('2026-03-15T10:30:00Z');

/** A running subscription; `fields` override what a case is about. */
function subscription(fields) {
    return {
        plan: 'STANDARD',
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        trialEndsAt: null,
        startedAt: at('2025-01-01T00:00:00Z'),
        currentPeriodStart: null,
        currentPeriodEnd: null,
        billingAnchorDay: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        pendingPlan: null,
        pendingEffectiveAt: null,
        ...fields,
    };
}

const effective = (sub, announcedAt = ANNOUNCED) => retirementReach(sub, announcedAt);

// @requirement SC-SUB-027 — A retirement's date is the end of a term at least three calendar months away
describe('the effective date of a retirement', () => {
    test('monthly, periods starting on the 1st: the first period end from 15 June on — 1 July', () => {
        const reach = effective(
            subscription({
                currentPeriodStart: at('2026-03-01T00:00:00Z'),
                currentPeriodEnd: at('2026-04-01T00:00:00Z'),
            }),
        );
        assert.deepEqual(reach, {
            reached: true,
            effectiveAt: at('2026-07-01T00:00:00Z'),
            lastDayToCancel: '2026-06-30',
            billingCycle: 'MONTHLY',
        });
    });

    test('a term that ends at the time of day it was booked leaves the whole day before as the last', () => {
        const reach = effective(
            subscription({
                currentPeriodStart: at('2026-03-01T14:23:00Z'),
                currentPeriodEnd: at('2026-04-01T14:23:00Z'),
            }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2026-07-01T14:23:00.000Z');
        assert.equal(reach.lastDayToCancel, '2026-06-30', 'not the effective day itself');
    });

    test('yearly, the term ending on 31 December: 1 January', () => {
        const reach = effective(
            subscription({
                billingCycle: 'YEARLY',
                currentPeriodStart: at('2026-01-01T00:00:00Z'),
                currentPeriodEnd: at('2027-01-01T00:00:00Z'),
            }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2027-01-01T00:00:00.000Z');
        assert.equal(reach.lastDayToCancel, '2026-12-31');
    });

    test('yearly, the term ending on 31 March, less than three months away: a year later', () => {
        const reach = effective(
            subscription({
                billingCycle: 'YEARLY',
                currentPeriodStart: at('2025-04-01T00:00:00Z'),
                currentPeriodEnd: at('2026-04-01T00:00:00Z'),
            }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2027-04-01T00:00:00.000Z');
    });

    test('a term ending exactly three months after the announcement is the effective date', () => {
        const reach = effective(
            subscription({
                currentPeriodStart: at('2026-03-15T10:30:00Z'),
                currentPeriodEnd: at('2026-04-15T10:30:00Z'),
            }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2026-06-15T10:30:00.000Z');
    });

    test('and one a millisecond earlier is not', () => {
        const reach = effective(
            subscription({
                currentPeriodStart: at('2026-03-15T10:29:59.999Z'),
                currentPeriodEnd: at('2026-04-15T10:29:59.999Z'),
            }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2026-07-15T10:29:59.999Z');
    });

    test('periods anchored on the 31st land on the last day of a shorter month', () => {
        const reach = effective(
            subscription({
                billingAnchorDay: 31,
                currentPeriodStart: at('2026-03-31T00:00:00Z'),
                currentPeriodEnd: at('2026-04-30T00:00:00Z'),
            }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2026-06-30T00:00:00.000Z');
    });

    test('a subscription without a period end counts its terms from its start', () => {
        const reach = effective(subscription({ startedAt: at('2025-05-10T00:00:00Z') }));
        // 10 June is before 15 June, so 10 July.
        assert.equal(reach.effectiveAt.toISOString(), '2026-07-10T00:00:00.000Z');
    });
});

// @requirement SC-SUB-027 — A retirement's date is the end of a term at least three calendar months away
describe('a subscription in its trial', () => {
    test('counts its terms from the end of the trial', () => {
        const reach = effective(
            subscription({ status: 'TRIAL', trialEndsAt: at('2026-04-02T00:00:00Z') }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2026-07-02T00:00:00.000Z');
    });

    test('takes effect at the end of the trial where that is far enough away', () => {
        const reach = effective(
            subscription({ status: 'TRIAL', trialEndsAt: at('2026-08-01T00:00:00Z') }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2026-08-01T00:00:00.000Z');
    });
});

// @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
// @requirement SC-SUB-027 — A retirement's date is the end of a term at least three calendar months away
describe('a subscription with a change of rhythm scheduled', () => {
    const running = {
        currentPeriodStart: at('2026-03-01T00:00:00Z'),
        currentPeriodEnd: at('2026-04-01T00:00:00Z'),
        pendingPlan: 'STANDARD',
        pendingBillingCycle: 'YEARLY',
    };

    test('counts its terms in the new rhythm from the day it lands, never inside the yearly term', () => {
        const reach = effective(
            subscription({ ...running, pendingEffectiveAt: at('2026-04-01T00:00:00Z') }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2027-04-01T00:00:00.000Z');
        assert.equal(reach.billingCycle, 'YEARLY');
    });

    test('keeps the old rhythm where the change lands after the effective date', () => {
        const reach = effective(
            subscription({ ...running, pendingEffectiveAt: at('2026-08-01T00:00:00Z') }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2026-07-01T00:00:00.000Z');
        assert.equal(reach.billingCycle, 'MONTHLY');
    });

    test('is billed in the new rhythm where the change lands on the effective date', () => {
        const reach = effective(
            subscription({ ...running, pendingEffectiveAt: at('2026-07-01T00:00:00Z') }),
        );
        assert.equal(reach.effectiveAt.toISOString(), '2026-07-01T00:00:00.000Z');
        assert.equal(reach.billingCycle, 'YEARLY');
    });
});

describe('a subscription a retirement does not reach', () => {
    const running = {
        currentPeriodStart: at('2026-03-01T00:00:00Z'),
        currentPeriodEnd: at('2026-04-01T00:00:00Z'),
    };

    test('one that has ended', () => {
        assert.deepEqual(effective(subscription({ ...running, status: 'CANCELED' })), {
            reached: false,
            reason: 'ended',
        });
    });

    test('one whose cancellation lands by the effective date', () => {
        assert.deepEqual(
            effective(
                subscription({
                    ...running,
                    canceledAt: at('2026-03-10T00:00:00Z'),
                    canceledEffectiveAt: at('2026-07-01T00:00:00Z'),
                }),
            ),
            { reached: false, reason: 'cancelled-before' },
        );
    });

    test('but one whose cancellation lands after it is reached', () => {
        const reach = effective(
            subscription({
                ...running,
                canceledAt: at('2026-03-10T00:00:00Z'),
                canceledEffectiveAt: at('2026-08-01T00:00:00Z'),
            }),
        );
        assert.equal(reach.reached, true);
    });

    test('one a scheduled change moves to another plan by then', () => {
        assert.deepEqual(
            effective(
                subscription({
                    ...running,
                    pendingPlan: 'PRO',
                    pendingEffectiveAt: at('2026-04-01T00:00:00Z'),
                }),
            ),
            { reached: false, reason: 'changes-before' },
        );
    });

    test('but a scheduled change of rhythm keeps it on the plan, so it is reached', () => {
        const reach = effective(
            subscription({
                ...running,
                pendingPlan: 'STANDARD',
                pendingBillingCycle: 'YEARLY',
                pendingEffectiveAt: at('2026-04-01T00:00:00Z'),
            }),
        );
        assert.equal(reach.reached, true);
    });

    test('one that took a newer version for the end of its term, landing by then', () => {
        assert.deepEqual(
            effective(
                subscription({
                    ...running,
                    planVersion: { id: 'pv-1' },
                    pendingPlan: 'STANDARD',
                    pendingBillingCycle: 'MONTHLY',
                    pendingChangeVersionId: 'pv-3',
                    pendingEffectiveAt: at('2026-05-01T00:00:00Z'),
                }),
            ),
            { reached: false, reason: 'changes-before' },
        );
    });

    test('but one whose newer version lands after the date, or whose change keeps its version, is reached', () => {
        const taken = {
            ...running,
            planVersion: { id: 'pv-1' },
            pendingPlan: 'STANDARD',
            pendingBillingCycle: 'MONTHLY',
        };
        const later = effective(
            subscription({
                ...taken,
                pendingChangeVersionId: 'pv-3',
                pendingEffectiveAt: at('2026-08-01T00:00:00Z'),
            }),
        );
        const keeps = effective(
            subscription({
                ...taken,
                pendingChangeVersionId: 'pv-1',
                pendingEffectiveAt: at('2026-05-01T00:00:00Z'),
            }),
        );
        assert.equal(later.reached, true);
        assert.equal(keeps.reached, true);
    });

    test('one with no date to count a term from', () => {
        assert.deepEqual(effective(subscription({ startedAt: null })), {
            reached: false,
            reason: 'no-term',
        });
    });
});

// @requirement SC-SUB-027 — A retirement's date is the end of a term at least three calendar months away
describe('three calendar months', () => {
    test('keep the day of the month and the time of day', () => {
        assert.equal(
            calendarMonthsAfter(at('2026-03-15T10:30:00Z'), 3).toISOString(),
            '2026-06-15T10:30:00.000Z',
        );
    });

    test('end on the last day of a month that has no such day', () => {
        assert.equal(
            calendarMonthsAfter(at('2026-11-30T00:00:00Z'), 3).toISOString(),
            '2027-02-28T00:00:00.000Z',
        );
        assert.equal(
            calendarMonthsAfter(at('2027-11-30T00:00:00Z'), 3).toISOString(),
            '2028-02-29T00:00:00.000Z',
            'a leap year',
        );
    });

    test('cross into the next year', () => {
        assert.equal(
            calendarMonthsAfter(at('2026-12-31T00:00:00Z'), 3).toISOString(),
            '2027-03-31T00:00:00.000Z',
        );
    });
});

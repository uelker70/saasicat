// Whether a retirement reminds a subscription, and when: once, 14 days before
// it takes effect, where staying put costs it something in the rhythm it is
// billed in then.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    retirementCostsTheSubscription,
    retirementReminderDueAt,
    retirementReminderIsDue,
} from '../dist/index.js';

const RETIRED = { monthlyNet: 49, yearlyNet: 490 };
const FEATURE_REMOVED = {
    field: 'features.removed',
    oldValue: ['exports'],
    newValue: [],
    direction: 'REGRESSION',
};
const FEATURE_ADDED = {
    field: 'features.added',
    oldValue: [],
    newValue: ['exports'],
    direction: 'IMPROVEMENT',
};
const QUOTA_LOWER = {
    field: 'quotas.users',
    oldValue: 10,
    newValue: 5,
    direction: 'REGRESSION',
};

/** A retirement onto a replacement priced as `prices`, with `changes` beside the prices. */
function retiring(prices, changes = []) {
    return {
        retired: RETIRED,
        replacement: { ...RETIRED, ...prices },
        changes,
        lastDayToCancel: '2026-06-30',
    };
}

// @requirement SC-SUB-034 — Where staying put costs something, a subscription is reminded once
describe('whether staying put costs a subscription something', () => {
    for (const [what, prices, changes, rhythm, costs] of [
        ['dearer in the rhythm it is billed in', { monthlyNet: 52 }, [], 'MONTHLY', true],
        ['a cent dearer in its rhythm', { monthlyNet: 49.01 }, [], 'MONTHLY', true],
        ['as dear in its rhythm', {}, [], 'MONTHLY', false],
        ['a cent cheaper in its rhythm', { monthlyNet: 48.99 }, [], 'MONTHLY', false],
        ['dearer only in the other rhythm', { yearlyNet: 520 }, [], 'MONTHLY', false],
        ['dearer in its rhythm, the yearly one', { yearlyNet: 520 }, [], 'YEARLY', true],
        ['not sold in its rhythm', { monthlyNet: null }, [], 'MONTHLY', true],
        [
            'cheaper, with a feature taken away',
            { monthlyNet: 45 },
            [FEATURE_REMOVED],
            'MONTHLY',
            true,
        ],
        ['as dear, with a quota lower', {}, [QUOTA_LOWER], 'MONTHLY', true],
        ['cheaper, with a feature added', { monthlyNet: 45 }, [FEATURE_ADDED], 'MONTHLY', false],
    ]) {
        test(`${what}`, () => {
            assert.equal(retirementCostsTheSubscription(retiring(prices, changes), rhythm), costs);
        });
    }
});

// @requirement SC-SUB-034 — Where staying put costs something, a subscription is reminded once
describe('when the reminder is due', () => {
    test('14 days before the date, at its time of day', () => {
        assert.equal(
            retirementReminderDueAt({ effectiveAt: '2026-07-01T00:00:00.000Z' }).toISOString(),
            '2026-06-17T00:00:00.000Z',
        );
        // Across a turn of the year, and at the hour a subscription was booked.
        assert.equal(
            retirementReminderDueAt({ effectiveAt: '2027-01-01T09:30:00.000Z' }).toISOString(),
            '2026-12-18T09:30:00.000Z',
        );
    });

    test('from that moment until the date, and not a millisecond either side', () => {
        const notice = { effectiveAt: '2026-07-01T00:00:00.000Z' };
        const dueAt = (iso) => retirementReminderIsDue(notice, new Date(iso));

        assert.deepEqual(
            [
                dueAt('2026-06-16T23:59:59.999Z'),
                dueAt('2026-06-17T00:00:00.000Z'),
                dueAt('2026-06-30T23:59:59.999Z'),
                dueAt('2026-07-01T00:00:00.000Z'),
            ],
            [false, true, true, false],
        );
    });
});

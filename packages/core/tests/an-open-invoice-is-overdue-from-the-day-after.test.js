// When an open invoice is overdue and by how many days, read as calendar days
// of the installation's zone; and which attempt of an invoice is its latest.

// @requirement SC-ADM-044 — An operator lists what subscribers still owe and are still owed, across every tenant

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { daysOverdue, isOverdueOn, latestAttemptsOf } from '../dist/index.js';

describe('an open invoice', () => {
    for (const [dueDate, today, overdue, days] of [
        ['2026-02-15', '2026-02-14', false, 0],
        ['2026-02-15', '2026-02-15', false, 0],
        ['2026-02-15', '2026-02-16', true, 1],
        ['2026-02-28', '2026-03-01', true, 1],
        ['2028-02-28', '2028-03-01', true, 2],
        ['2026-12-31', '2027-01-01', true, 1],
        ['2026-03-28', '2026-03-30', true, 2],
        ['2026-01-15', '2026-02-16', true, 32],
    ]) {
        test(`due ${dueDate} and read on ${today} is ${days} days overdue`, () => {
            assert.equal(isOverdueOn(dueDate, today), overdue);
            assert.equal(daysOverdue(dueDate, today), days);
        });
    }

    test('a day that is no day is refused rather than counted', () => {
        assert.throws(() => daysOverdue('2026-02', '2026-03-01'), RangeError);
    });
});

describe('the latest attempts', () => {
    const attempt = (invoiceId, number) => ({
        id: `${invoiceId}-${number}`,
        invoiceId,
        attempt: number,
    });

    test('are each invoice’s highest attempt, in whatever order the attempts come', () => {
        const latest = latestAttemptsOf([
            attempt('i-1', 1),
            attempt('i-2', 1),
            attempt('i-1', 3),
            attempt('i-1', 2),
        ]);

        assert.deepEqual([...latest].map(([invoiceId, { id }]) => [invoiceId, id]).sort(), [
            ['i-1', 'i-1-3'],
            ['i-2', 'i-2-1'],
        ]);
    });

    test('are none of no attempts', () => {
        assert.equal(latestAttemptsOf([]).size, 0);
    });
});

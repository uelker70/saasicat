// Which reminder an ended subscription's tenant is due before its data is
// deleted: a lead time is due from the installation's day that many days before
// the deletion day, and a run reminds of the smallest one due that no reminder
// told covers. Pure, so every boundary is asked here rather than through a run.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    dayInZone,
    deletionReminderDue,
    deletionReminderSubjectIn,
    deletionReminderSubjectOf,
} from '../dist/index.js';

// AutohausPro's lead times, and a deletion day whose lead days are 1, 20 and
// 27 December: a subscription that ended on 30 November with 30 days to read.
const LEAD_TIMES = [29, 10, 3];
const DELETES_ON = '2026-12-30';

/** The lead time due on `today`, after reminders told for `told`. */
const dueOn = (today, { told = [], leads = LEAD_TIMES, deletesOn = DELETES_ON } = {}) =>
    deletionReminderDue({
        deletesOn,
        reminderDaysBefore: leads,
        toldDaysBefore: told,
        today,
    });

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the reminder due before a deletion', () => {
    test('is none the day before the largest lead time is due', () => {
        assert.equal(dueOn('2026-11-30'), null);
    });

    test('is the largest lead time on its day', () => {
        // Also the day a subscription with 29 days to read ended on: a lead
        // time equal to the period is due at once.
        assert.equal(dueOn('2026-12-01'), 29);
    });

    test('is none the day after, once that reminder was told', () => {
        assert.equal(dueOn('2026-12-02', { told: [29] }), null);
    });

    test('is none the day before the next lead time is due', () => {
        assert.equal(dueOn('2026-12-19', { told: [29] }), null);
    });

    test('is the next lead time on its day', () => {
        assert.equal(dueOn('2026-12-20', { told: [29] }), 10);
    });

    test('is the smallest lead time on its day, once the others were told', () => {
        assert.equal(dueOn('2026-12-27', { told: [29, 10] }), 3);
    });

    test('is still the smallest lead time the day before the deletion, where no run told it', () => {
        assert.equal(dueOn('2026-12-29', { told: [29, 10] }), 3);
    });

    test('is none on the deletion day itself, though nothing was told', () => {
        assert.equal(dueOn('2026-12-30'), null);
    });

    test('is none after the deletion day', () => {
        assert.equal(dueOn('2026-12-31'), null);
    });

    test('covers two lead times that passed between runs with one reminder, for the smaller', () => {
        assert.equal(dueOn('2026-12-28', { told: [29] }), 3);
        assert.equal(
            dueOn('2026-12-29', { told: [29, 3] }),
            null,
            'the 10-day one is not sent late',
        );
    });

    test('covers the lead times a period shorter than them passed with one reminder at once', () => {
        // Ten days to read: ended on 20 December. The 29-day lead time passed
        // before the end, the 10-day one is due that day: one reminder, of 10.
        assert.equal(dueOn('2026-12-20'), 10);
        assert.equal(dueOn('2026-12-26', { told: [10] }), null);
        assert.equal(dueOn('2026-12-27', { told: [10] }), 3);
    });

    test('covers every lead time with one reminder where the period is shorter than all of them', () => {
        // Two days to read: ended on 1 December, deleted on 3 December.
        assert.equal(dueOn('2026-12-01', { deletesOn: '2026-12-03' }), 3);
        assert.equal(dueOn('2026-12-02', { deletesOn: '2026-12-03', told: [3] }), null);
    });

    test('is the same whatever order the file names the lead times in', () => {
        assert.equal(dueOn('2026-12-20', { told: [29], leads: [3, 29, 10] }), 10);
        assert.equal(dueOn('2026-12-01', { leads: [3, 10, 29] }), 29);
    });

    test('counts a lead day back across the end of a year', () => {
        // Deleted on 5 January: the 10-day reminder is due on 26 December.
        assert.equal(dueOn('2026-12-25', { deletesOn: '2027-01-05', told: [29] }), null);
        assert.equal(dueOn('2026-12-26', { deletesOn: '2027-01-05', told: [29] }), 10);
    });

    test('counts a reminder told for a lead time the file no longer names as covering the larger ones', () => {
        // Told at 7 days under an earlier file; the file now names 29, 10 and 3.
        assert.equal(dueOn('2026-12-26', { told: [7] }), null);
        assert.equal(dueOn('2026-12-27', { told: [7] }), 3);
    });

    test('is a lead time added to the file after a larger one was told, on its day', () => {
        assert.equal(dueOn('2026-12-09', { told: [29], leads: [29, 20, 3] }), null);
        assert.equal(dueOn('2026-12-10', { told: [29], leads: [29, 20, 3] }), 20);
    });

    test('takes a lead time longer than the calendar reaches back as one due long since', () => {
        // A million days before 2026-12-30 is a day no calendar day names.
        const leads = [29, 10, 3, 1_000_000];
        assert.equal(dueOn('2026-11-30', { leads }), 1_000_000);
        assert.equal(dueOn('2026-12-01', { leads }), 29);
        assert.equal(dueOn('2026-12-01', { leads, told: [1_000_000] }), 29);
        assert.equal(dueOn('2026-12-20', { leads, told: [1_000_000, 29] }), 10);
        assert.equal(dueOn('2026-12-27', { leads, told: [1_000_000, 29, 10] }), 3);
        assert.equal(dueOn('2026-12-30', { leads }), null);
    });
});

// @requirement SC-CANC-022 — A tenant is reminded before its data is deleted
describe('the day a reminder is decided on', () => {
    // The 10-day lead time is due on 20 December, in the installation's days.
    const tenDayLeadAt = (at, timeZone) => dueOn(dayInZone(new Date(at), timeZone), { told: [29] });

    test("is the installation's day ahead of UTC, not UTC's", () => {
        // 23:30 UTC on 19 December is already 20 December in Berlin.
        assert.equal(tenDayLeadAt('2026-12-19T23:30:00.000Z', 'Europe/Berlin'), 10);
        assert.equal(tenDayLeadAt('2026-12-19T23:30:00.000Z', 'UTC'), null);
    });

    test("is the installation's day behind UTC, not UTC's", () => {
        // 03:00 UTC on 20 December is still 19 December in New York.
        assert.equal(tenDayLeadAt('2026-12-20T03:00:00.000Z', 'America/New_York'), null);
        assert.equal(tenDayLeadAt('2026-12-20T03:00:00.000Z', 'UTC'), 10);
    });
});

describe('the subject a reminder is recorded under', () => {
    test('names the end and the lead time, and reads back as both', () => {
        const subject = deletionReminderSubjectOf({ subscriptionEndId: 'end-1', daysBefore: 10 });
        assert.equal(subject, 'end-1:10');
        assert.deepEqual(deletionReminderSubjectIn(subject), {
            subscriptionEndId: 'end-1',
            daysBefore: 10,
        });
    });

    test('reads an id holding the separator back whole', () => {
        const reminder = { subscriptionEndId: 'urn:end:1', daysBefore: 3 };
        assert.deepEqual(deletionReminderSubjectIn(deletionReminderSubjectOf(reminder)), reminder);
    });

    test('reads a subject no reminder wrote as none', () => {
        for (const subject of [
            'end-1',
            ':10',
            'end-1:',
            'end-1:0',
            'end-1:010',
            'end-1:1.5',
            'end-1:-3',
        ]) {
            assert.equal(deletionReminderSubjectIn(subject), null, subject);
        }
    });
});

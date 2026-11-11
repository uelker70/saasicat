// What a tenant is told when it confirms the end of its subscription: the
// read-only period, the last day it can still read on, and the day its data is
// deleted on — counted as an end recorded at the moment of confirmation would
// be. Pure, so every boundary is asked here rather than through a store.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addDaysToDay,
    announcedDeletionOf,
    dayInZone,
    deletionAnnouncedFor,
    endKeepsAnnouncedDay,
    toSubscriptionEndAnnouncement,
} from '../dist/index.js';

const BERLIN = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';
const LONG_BEFORE = '2026-11-10T09:15:00.000Z';

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
const daysBetween = (from, to) =>
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

/**
 * When a cancellation lands and is confirmed, in which period and zone, and
 * the days confirming it announces: one row per boundary the cases below ask.
 */
const ANNOUNCED = {
    atMidnight: {
        // 00:00 on 1 April in Berlin, summer time.
        endsAt: '2027-03-31T22:00:00.000Z',
        announcedAt: LONG_BEFORE,
        readOnlyDays: 30,
        zone: BERLIN,
        readOnlyUntil: '2027-04-30',
        deletesOn: '2027-05-01',
    },
    aMillisecondBeforeMidnight: {
        // 23:59:59.999 on 31 March in Berlin.
        endsAt: '2027-03-31T21:59:59.999Z',
        announcedAt: LONG_BEFORE,
        readOnlyDays: 30,
        zone: BERLIN,
        readOnlyUntil: '2027-04-29',
        deletesOn: '2027-04-30',
    },
    behindUtc: {
        // 03:00 UTC on 6 January is 22:00 on 5 January in New York.
        endsAt: '2027-01-06T03:00:00.000Z',
        announcedAt: LONG_BEFORE,
        readOnlyDays: 30,
        zone: NEW_YORK,
        readOnlyUntil: '2027-02-03',
        deletesOn: '2027-02-04',
    },
    theSameMomentInUtc: {
        endsAt: '2027-01-06T03:00:00.000Z',
        announcedAt: LONG_BEFORE,
        readOnlyDays: 30,
        zone: 'UTC',
        readOnlyUntil: '2027-02-04',
        deletesOn: '2027-02-05',
    },
    acrossTheClockChange: {
        // 00:00 on 1 October 2026 in Berlin; the clocks go back on 25 October,
        // so thirty spans of 24 hours would end at 23:00 on 30 October.
        endsAt: '2026-09-30T22:00:00.000Z',
        announcedAt: '2026-09-01T08:00:00.000Z',
        readOnlyDays: 30,
        zone: BERLIN,
        readOnlyUntil: '2026-10-30',
        deletesOn: '2026-10-31',
    },
    oneReadOnlyDay: {
        endsAt: '2027-03-31T22:00:00.000Z',
        announcedAt: LONG_BEFORE,
        readOnlyDays: 1,
        zone: BERLIN,
        readOnlyUntil: '2027-04-01',
        deletesOn: '2027-04-02',
    },
    confirmedHoursBeforeItLands: {
        // Lands at 17:00 on 1 April in Berlin, confirmed at 08:00 the same day.
        endsAt: '2027-04-01T15:00:00.000Z',
        announcedAt: '2027-04-01T06:00:00.000Z',
        readOnlyDays: 30,
        zone: BERLIN,
        readOnlyUntil: '2027-04-30',
        deletesOn: '2027-05-01',
    },
    confirmedAfterItLandsTheSameDay: {
        endsAt: '2027-03-31T22:00:00.000Z',
        // 23:59 on 1 April in Berlin.
        announcedAt: '2027-04-01T21:59:00.000Z',
        readOnlyDays: 30,
        zone: BERLIN,
        readOnlyUntil: '2027-04-30',
        deletesOn: '2027-05-01',
    },
    confirmedDaysAfterItLands: {
        endsAt: '2027-03-31T22:00:00.000Z',
        // 10:00 on 10 April in Berlin.
        announcedAt: '2027-04-10T08:00:00.000Z',
        readOnlyDays: 30,
        zone: BERLIN,
        readOnlyUntil: '2027-05-09',
        deletesOn: '2027-05-10',
    },
    confirmedAMinuteIntoTheNextDay: {
        endsAt: '2027-03-31T22:00:00.000Z',
        // 00:01 on 2 April in Berlin.
        announcedAt: '2027-04-01T22:01:00.000Z',
        readOnlyDays: 1,
        zone: BERLIN,
        readOnlyUntil: '2027-04-02',
        deletesOn: '2027-04-03',
    },
};

/** Asserts that confirming the cancellation of `row` announces the days it names. */
function announcesTheDaysOf(row) {
    const announced = deletionAnnouncedFor(
        new Date(row.endsAt),
        new Date(row.announcedAt),
        row.readOnlyDays,
        row.zone,
    );
    assert.deepEqual(announced, {
        readOnlyDays: row.readOnlyDays,
        readOnlyUntil: row.readOnlyUntil,
        deletesOn: row.deletesOn,
    });
}

// @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
describe('the days a confirmed cancellation announces', () => {
    test('landing at midnight in the zone, its first day without the subscription is the next one', () =>
        announcesTheDaysOf(ANNOUNCED.atMidnight));

    test('landing a millisecond before midnight in the zone, the day it lands on is the earlier one', () =>
        announcesTheDaysOf(ANNOUNCED.aMillisecondBeforeMidnight));

    test('in a zone behind UTC, the day is the one the zone shows', () =>
        announcesTheDaysOf(ANNOUNCED.behindUtc));

    test('the same moment read in UTC lands a day later', () =>
        announcesTheDaysOf(ANNOUNCED.theSameMomentInUtc));

    test('a period across the change back from summer time counts days, not 24-hour spans', () =>
        announcesTheDaysOf(ANNOUNCED.acrossTheClockChange));

    test('one read-only day leaves the day it lands on as the last readable day', () =>
        announcesTheDaysOf(ANNOUNCED.oneReadOnlyDay));

    test('confirmed on the day it lands, hours before it lands, counts from that day', () =>
        announcesTheDaysOf(ANNOUNCED.confirmedHoursBeforeItLands));

    test('confirmed after it lands, on the same day, still counts from that day', () =>
        announcesTheDaysOf(ANNOUNCED.confirmedAfterItLandsTheSameDay));

    test('confirmed days after it lands counts from the day it is confirmed', () =>
        announcesTheDaysOf(ANNOUNCED.confirmedDaysAfterItLands));

    test('confirmed a minute into the next day counts from the next day', () =>
        announcesTheDaysOf(ANNOUNCED.confirmedAMinuteIntoTheNextDay));

    test('never leaves less than the period from the day it is confirmed, nor from the day it lands', () => {
        for (const [name, row] of Object.entries(ANNOUNCED)) {
            const { deletesOn, readOnlyUntil } = deletionAnnouncedFor(
                new Date(row.endsAt),
                new Date(row.announcedAt),
                row.readOnlyDays,
                row.zone,
            );
            const confirmedOn = dayInZone(new Date(row.announcedAt), row.zone);
            const landsOn = dayInZone(new Date(row.endsAt), row.zone);
            assert.ok(daysBetween(confirmedOn, deletesOn) >= row.readOnlyDays, name);
            assert.ok(daysBetween(landsOn, deletesOn) >= row.readOnlyDays, name);
            assert.equal(readOnlyUntil, addDaysToDay(deletesOn, -1), name);
        }
    });
});

describe('an announcement read back from a store', () => {
    const row = {
        id: 'announcement-1',
        tenantId: 't-1',
        subscriptionId: 'sub-1',
        endsAt: new Date('2027-03-31T22:00:00.000Z'),
        readOnlyDays: 30,
        announcedAt: new Date('2026-11-10T09:15:00.000Z'),
        announcedBy: 'user:admin-1',
    };

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    test("takes its day from Prisma's date at midnight UTC and from Drizzle's text alike, and keeps its period", () => {
        const fromPrisma = toSubscriptionEndAnnouncement({
            ...row,
            deletesOn: new Date('2027-05-01T00:00:00.000Z'),
        });
        const fromDrizzle = toSubscriptionEndAnnouncement({ ...row, deletesOn: '2027-05-01' });
        assert.deepEqual(fromPrisma, { ...row, deletesOn: '2027-05-01' });
        assert.deepEqual(fromPrisma, fromDrizzle);
    });

    // @requirement SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels
    test('reads back as what the tenant was told: its period, its deletion day and the day before it', () => {
        for (const [deletesOn, readOnlyUntil] of [
            ['2027-05-01', '2027-04-30'],
            ['2027-01-01', '2026-12-31'],
            ['2028-03-01', '2028-02-29'],
        ]) {
            assert.deepEqual(
                announcedDeletionOf(toSubscriptionEndAnnouncement({ ...row, deletesOn })),
                { readOnlyDays: 30, readOnlyUntil, deletesOn },
            );
        }
        const told = deletionAnnouncedFor(row.endsAt, row.announcedAt, 30, BERLIN);
        assert.deepEqual(
            announcedDeletionOf(toSubscriptionEndAnnouncement({ ...row, ...told })),
            told,
        );
    });

    test('refuses a column that holds no day, naming its table', () => {
        assert.throws(
            () => toSubscriptionEndAnnouncement({ ...row, deletesOn: 'soon' }),
            /subscription_end_announcements\.deletesOn of announcement-1 is not a day/,
        );
    });
});

/** Asserts whether an end landing at `endsAt` keeps the day announced for midnight into 1 April 2027 in Berlin. */
function keepsTheAnnouncedDay(endsAt, kept) {
    const announcement = { endsAt: new Date('2027-03-31T22:00:00.000Z') };
    assert.equal(endKeepsAnnouncedDay(announcement, new Date(endsAt)), kept);
}

// @requirement SC-CANC-030 — A subscription that ends earlier than announced keeps the day its tenant was told
describe('the end an announced day is kept for', () => {
    test('landing at the very moment announced keeps it', () =>
        keepsTheAnnouncedDay('2027-03-31T22:00:00.000Z', true));

    test('landing a millisecond later does not', () =>
        keepsTheAnnouncedDay('2027-03-31T22:00:00.001Z', false));

    test('landing a millisecond earlier keeps it', () =>
        keepsTheAnnouncedDay('2027-03-31T21:59:59.999Z', true));

    test('landing months earlier, ended at once, keeps it', () =>
        keepsTheAnnouncedDay('2026-11-15T10:00:00.000Z', true));
});

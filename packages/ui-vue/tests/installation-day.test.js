// Which day the administration shows for a value: the day a moment falls on in
// the installation's time zone, the last day an end still covers there, the
// day somebody picked as it was stored, and today there — each at the edges
// where one day turns into the next.

// @requirement SC-ADM-048 — Every day the administration shows is a day of the installation

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from 'vue';

import {
    DEFAULT_INSTALLATION_ZONE,
    dayOfMoment,
    formatDay,
    formatLastDayBefore,
    formatMomentDay,
    formatShortDay,
    formatStoredDay,
    installationZoneOf,
    lastDayBefore,
    storedDayOf,
    todayIn,
} from '../dist/client/index.js';
import { SUPER_ADMIN_MANIFEST_KEY, useInstallationDays } from '../dist/vue/index.js';

const BERLIN = 'Europe/Berlin';
const NEW_YORK = 'America/New_York';

describe('the installation’s zone', () => {
    test('is the one the manifest names, and UTC where it names none', () => {
        assert.equal(installationZoneOf({ timeZone: BERLIN }), BERLIN);
        assert.equal(installationZoneOf({}), DEFAULT_INSTALLATION_ZONE);
        assert.equal(installationZoneOf(null), 'UTC');
    });
});

describe('the day a moment falls on', () => {
    for (const [iso, zone, day] of [
        // 00:30 on 2 November in Berlin, still 1 November in UTC.
        ['2026-11-01T23:30:00.000Z', BERLIN, '2026-11-02'],
        ['2026-11-01T23:30:00.000Z', 'UTC', '2026-11-01'],
        ['2026-11-02T03:30:00.000Z', NEW_YORK, '2026-11-01'],
        // Midnight in Berlin, and the moment before it.
        ['2026-11-01T22:59:59.999Z', BERLIN, '2026-11-01'],
        ['2026-11-01T23:00:00.000Z', BERLIN, '2026-11-02'],
    ]) {
        test(`${iso} in ${zone} is ${day}`, () => {
            assert.equal(dayOfMoment(iso, zone), day);
        });
    }
});

describe('the last day an end covers', () => {
    for (const [iso, zone, day] of [
        // An end at midnight before 1 December in Berlin covers 30 November.
        ['2026-11-30T23:00:00.000Z', BERLIN, '2026-11-30'],
        ['2026-11-30T23:00:00.001Z', BERLIN, '2026-12-01'],
        ['2026-12-01T00:00:00.000Z', 'UTC', '2026-11-30'],
        // An end within a day covers that day.
        ['2026-10-15T08:00:00.000Z', BERLIN, '2026-10-15'],
    ]) {
        test(`at ${iso} in ${zone} is ${day}`, () => {
            assert.equal(lastDayBefore(iso, zone), day);
        });
    }
});

describe('a day somebody picked', () => {
    test('is the day it was stored as, in every zone, the last moment of it too', () => {
        assert.equal(storedDayOf('2026-07-01T00:00:00.000Z'), '2026-07-01');
        assert.equal(storedDayOf('2026-07-31T23:59:59.999Z'), '2026-07-31');
        assert.equal(storedDayOf('2026-07-01'), '2026-07-01');
    });
});

describe('today', () => {
    test('is the installation’s, which is ahead of UTC east of Greenwich', () => {
        const now = new Date('2026-11-01T23:30:00.000Z');

        assert.deepEqual(
            [todayIn(BERLIN, now), todayIn('UTC', now), todayIn(NEW_YORK, now)],
            ['2026-11-02', '2026-11-01', '2026-11-01'],
        );
    });
});

describe('a day as the reader writes it', () => {
    test('is the calendar day it names, and a dash where there is none', () => {
        assert.equal(formatDay('2026-07-01', 'de-DE'), '01.07.2026');
        // A moment is no calendar day: which day it is, the functions above say.
        assert.equal(formatDay('2026-11-01T23:30:00.000Z', 'de-DE'), 'Invalid Date');
        assert.equal(formatShortDay('2026-07-01', 'en-GB'), '01 Jul 2026');
        assert.equal(formatMomentDay('2026-11-01T23:30:00.000Z', BERLIN, 'de-DE'), '02.11.2026');
        assert.equal(
            formatLastDayBefore('2026-11-30T23:00:00.000Z', BERLIN, 'de-DE'),
            '30.11.2026',
        );
        assert.equal(formatStoredDay('2026-07-31T23:59:59.999Z', 'de-DE'), '31.07.2026');
        for (const none of [null, undefined, '']) {
            assert.deepEqual(
                [
                    formatMomentDay(none, BERLIN, 'de-DE'),
                    formatLastDayBefore(none, BERLIN, 'de-DE'),
                    formatStoredDay(none, 'de-DE'),
                ],
                ['—', '—', '—'],
            );
        }
    });
});

describe('the days a page asks for', () => {
    /** `useInstallationDays` in an app whose shell serves `manifest`. */
    function daysUnder(manifest) {
        const app = createApp({});
        app.provide(SUPER_ADMIN_MANIFEST_KEY, () => manifest);
        return app.runWithContext(() => useInstallationDays());
    }

    test('are read in the zone the shell’s manifest names', () => {
        const days = daysUnder({ timeZone: BERLIN });

        assert.deepEqual(
            [
                days.timeZone,
                days.ofMoment('2026-11-01T23:30:00.000Z'),
                days.lastBefore('2026-11-30T23:00:00.000Z'),
                days.stored('2026-07-31T23:59:59.999Z'),
            ],
            [BERLIN, '2026-11-02', '2026-11-30', '2026-07-31'],
        );
        assert.match(days.today(), /^\d{4}-\d{2}-\d{2}$/);
    });

    test('are UTC days without a manifest, and a dash for a value not there', () => {
        const days = daysUnder(null);

        assert.deepEqual(
            [days.timeZone, days.ofMoment('2026-11-01T23:30:00.000Z'), days.ofMoment(null)],
            ['UTC', '2026-11-01', '—'],
        );
        assert.deepEqual([days.lastBefore(undefined), days.stored('')], ['—', '—']);
    });
});

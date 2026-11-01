// The days a moment is handed out with: the last day of what it ends and the
// first of what it begins, in the installation's zone, under a name that
// follows the moment's — and the zone where the file names none.

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_INSTALLATION_ZONE,
    daysAround,
    daysKeyOf,
    installationZoneOf,
    withDays,
} from '../dist/index.js';

const BERLIN = 'Europe/Berlin';
const at = (iso) => new Date(iso);

describe('the days around a moment', () => {
    for (const [what, moment, zone, until, from] of [
        // Midnight before 1 December in Berlin is 23:00 UTC on 30 November.
        ['at midnight there', '2026-11-30T23:00:00.000Z', BERLIN, '2026-11-30', '2026-12-01'],
        ['a millisecond after it', '2026-11-30T23:00:00.001Z', BERLIN, '2026-12-01', '2026-12-01'],
        ['a millisecond before it', '2026-11-30T22:59:59.999Z', BERLIN, '2026-11-30', '2026-11-30'],
        ['at noon', '2026-12-01T11:00:00.000Z', BERLIN, '2026-12-01', '2026-12-01'],
        // The clocks go forward at two in the morning; midnight is still 23:00 UTC.
        [
            'on the day summer time begins',
            '2026-03-28T23:00:00.000Z',
            BERLIN,
            '2026-03-28',
            '2026-03-29',
        ],
        // From then on midnight is 22:00 UTC.
        ['in summer', '2026-07-31T22:00:00.000Z', BERLIN, '2026-07-31', '2026-08-01'],
        ['in UTC', '2026-12-01T00:00:00.000Z', 'UTC', '2026-11-30', '2026-12-01'],
    ]) {
        test(`${what}: ${until} until, ${from} from`, () => {
            assert.deepEqual(daysAround(at(moment), zone), { until, from });
        });
    }

    test('are refused for a zone the runtime does not know', () => {
        assert.throws(() => daysAround(at('2026-12-01T00:00:00.000Z'), 'Mars/Olympus'), RangeError);
    });
});

describe('the name the days stand under', () => {
    for (const [moment, days] of [
        ['startedAt', 'startedDays'],
        ['takesEffectAt', 'takesEffectDays'],
        ['currentPeriodEnd', 'currentPeriodEndDays'],
        ['effectiveFrom', 'effectiveFromDays'],
        // Only a trailing `At` is the suffix.
        ['Atlas', 'AtlasDays'],
    ]) {
        test(`${moment} gains ${days}`, () => assert.equal(daysKeyOf(moment), days));
    }
});

describe('a value handed out with the days of its moments', () => {
    const booking = {
        id: 'sb-1',
        startedAt: at('2026-11-30T23:00:00.000Z'),
        minimumTermEndsAt: '2027-11-30T23:00:00.000Z',
        canceledAt: null,
        label: 'Seats',
    };

    test('keeps every field and adds the days of each moment it names, a date or its text', () => {
        assert.deepEqual(withDays(booking, ['startedAt', 'minimumTermEndsAt'], BERLIN), {
            ...booking,
            startedDays: { until: '2026-11-30', from: '2026-12-01' },
            minimumTermEndsDays: { until: '2027-11-30', from: '2027-12-01' },
        });
    });

    test('names no days beside a moment that is absent', () => {
        const answer = withDays(booking, ['canceledAt'], BERLIN);
        assert.equal(answer.canceledDays, null);
        const without = withDays({ id: 'x' }, ['pendingVersionEffectiveAt'], BERLIN);
        assert.equal(without.pendingVersionEffectiveDays, null);
    });

    test('adds nothing it was not asked for', () => {
        assert.deepEqual(Object.keys(withDays(booking, [], BERLIN)), Object.keys(booking));
    });

    test('refuses a field that is not a moment, rather than name a day for it', () => {
        assert.throws(() => withDays(booking, ['label'], BERLIN), /label is not a moment/);
    });
});

describe('the installation’s zone', () => {
    test('is the one the settings name', () => {
        assert.equal(installationZoneOf({ timeZone: BERLIN }), BERLIN);
    });

    for (const [what, source] of [
        ['settings that name none', {}],
        ['no settings at all', null],
    ]) {
        test(`is UTC for ${what}`, () => {
            assert.equal(DEFAULT_INSTALLATION_ZONE, 'UTC');
            assert.equal(installationZoneOf(source), 'UTC');
        });
    }
});

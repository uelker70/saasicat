// @requirement SC-PROMO-031 — The administration reads a promo code's days in the zone the application names

// A promo code's day and moment, read in a zone, and the zone they are read in.
// The days are the ones the clocks change on in Berlin; every case runs with the
// process in Los Angeles, so a reading in the process's own zone comes out
// wrong.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_PROMO_DAY_ZONE,
    promoDayOf,
    promoDayZoneOf,
    promoMomentOf,
} from '../dist/index.js';

const processZone = process.env.TZ;
before(() => {
    process.env.TZ = 'America/Los_Angeles';
});
after(() => {
    process.env.TZ = processZone;
});

describe('a promo code’s day, read in a zone', () => {
    test('the start of 29 March in Berlin, the day the clocks go forward, is that day there and the day before in UTC', () => {
        assert.deepEqual(
            [
                promoDayOf('2026-03-28T23:00:00.000Z', 'Europe/Berlin'),
                promoDayOf('2026-03-28T23:00:00.000Z', 'UTC'),
            ],
            ['2026-03-29', '2026-03-28'],
        );
    });

    test('the end of 25 October in Berlin, the day the clocks go back, is that day, and a moment later the next', () => {
        assert.deepEqual(
            [
                promoDayOf('2026-10-25T22:59:59.999Z', 'Europe/Berlin'),
                promoDayOf('2026-10-25T23:00:00.000Z', 'Europe/Berlin'),
            ],
            ['2026-10-25', '2026-10-26'],
        );
    });

    test('is the day itself where the server sends a day, west of UTC and far east of it', () => {
        assert.deepEqual(
            [
                promoDayOf('2026-10-31', 'America/New_York'),
                promoDayOf('2026-10-31', 'Pacific/Kiritimati'),
            ],
            ['2026-10-31', '2026-10-31'],
        );
    });

    test('is nothing where there is no instant, or none that is a date', () => {
        assert.deepEqual(
            [null, undefined, '', 'not a date'].map((iso) => promoDayOf(iso, 'Europe/Berlin')),
            ['', '', '', ''],
        );
    });
});

describe('a promo code’s moment, read in a zone', () => {
    test('says the zone it is read in', () => {
        assert.deepEqual(
            [
                promoMomentOf('2026-10-05T15:44:35.000Z', 'Europe/Berlin'),
                promoMomentOf('2026-10-05T15:44:35.000Z', 'UTC'),
            ],
            ['2026-10-05 17:44:35 GMT+2', '2026-10-05 15:44:35 UTC'],
        );
    });

    test('is nothing where there is no instant', () => {
        assert.equal(promoMomentOf(null, 'UTC'), '');
    });
});

describe('the zone promo days are read in', () => {
    test('is UTC where the application names none', () => {
        assert.deepEqual([promoDayZoneOf(undefined), DEFAULT_PROMO_DAY_ZONE], ['UTC', 'UTC']);
    });

    test('is the one the application names, where the runtime can read it', () => {
        assert.equal(promoDayZoneOf('Europe/Berlin'), 'Europe/Berlin');
    });

    test('refuses a name the runtime cannot read, naming it, with the runtime’s reason as cause', () => {
        assert.throws(
            () => promoDayZoneOf('Europe/Atlantis'),
            (error) =>
                error.message.includes("promoCodes.timeZone 'Europe/Atlantis'") &&
                error.cause instanceof RangeError,
        );
    });
});

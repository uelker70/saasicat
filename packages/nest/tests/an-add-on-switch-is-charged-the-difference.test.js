// What a booking pays when it takes a newer version of its add-on: the
// difference for the rest of its period where the new version is dearer, the
// new price from its next period, and — for a switch taken for the end of its
// term — nothing from that moment until the switch's contract exists.
//
// Every case goes through `SubscriberChargeService.recordDueCharges` over a
// monthly subscription at 49 with Archive v1 booked monthly at 10 from
// 1 January.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { anAccount, line, utc } from './helpers/charge-journal.js';

const V1 = 'bv-archive';
const V2 = 'bv-archive-2';
const BOOKING = 'booking-1';

const standard = () => line('plan', 'STANDARD', 49, { sourceVersionId: 'pv-standard' });
const archive = () => line('bundle', 'ARCHIVE', 10, { sourceVersionId: V1 });
/** Archive v2 at `price`, marked with a switch at `at` where `at` is given. */
const archive2 = (price, at = null) =>
    line('bundle', 'ARCHIVE', price, {
        sourceVersionId: V2,
        metadata: at
            ? {
                  addOnSwitch: {
                      subscriptionBundleId: BOOKING,
                      fromBundleVersionId: V1,
                      effectiveAt: at.toISOString(),
                  },
              }
            : null,
    });

/** An account with Archive v1 booked from 1 January and January charged. */
async function booked(bookingOverrides = {}) {
    const account = anAccount();
    await account.contract({ lineItems: [standard(), archive()] });
    const booking = account.book({
        startedAt: utc('2026-01-01'),
        currentPeriodStart: utc('2026-01-01'),
        currentPeriodEnd: utc('2026-02-01'),
        createdAt: utc('2026-01-01'),
        pendingBundleVersionId: null,
        pendingVersionEffectiveAt: null,
        ...bookingOverrides,
    });
    await account.charge(utc('2026-01-10'));
    return { account, booking };
}

/** Moves the plan's window and the booking's, as a renewal job does. */
function roll(account, booking, start, end) {
    account.roll(utc(start), utc(end));
    booking.currentPeriodStart = utc(start);
    booking.currentPeriodEnd = utc(end);
}

/** The switch at `at` onto Archive v2 at `price`, as the switch writes it. */
async function switchAt(account, booking, at, price) {
    booking.bundleVersionId = V2;
    await account.supersede(at);
    await account.contract({ effectiveFrom: at, lineItems: [standard(), archive2(price, at)] });
}

/** The add-on's charges from `from` on, as `[period start, origin, amount]`. */
const addOnFrom = (account, from) =>
    account
        .entries()
        .filter(([day, source]) => day >= from && source === 'bundle')
        .map(([day, , origin, amount]) => [day, origin, amount]);

// @requirement SC-BUN-058 — A newer add-on version is taken by naming it, the way its kind says
describe('a switch at once', () => {
    test('to a dearer version is charged the difference for the rest of the period, and the new price after', async () => {
        const { account, booking } = await booked();
        roll(account, booking, '2026-02-01', '2026-03-01');
        await account.charge(utc('2026-02-01'));

        await switchAt(account, booking, utc('2026-02-15'), 12);
        await account.charge(utc('2026-02-15'));
        roll(account, booking, '2026-03-01', '2026-04-01');
        await account.charge(utc('2026-03-01'));

        // 2 a month more, for 14 of February's 28 days.
        assert.deepEqual(addOnFrom(account, '2026-02-01'), [
            ['2026-02-01', 'renewal', 10],
            ['2026-02-15', 'bundleChange', 1],
            ['2026-03-01', 'renewal', 12],
        ]);
    });

    test('to a cheaper version is charged nothing more, and nothing is paid back', async () => {
        const { account, booking } = await booked();
        roll(account, booking, '2026-02-01', '2026-03-01');
        await account.charge(utc('2026-02-01'));

        await switchAt(account, booking, utc('2026-02-15'), 8);
        await account.charge(utc('2026-02-15'));
        roll(account, booking, '2026-03-01', '2026-04-01');
        await account.charge(utc('2026-03-01'));

        assert.deepEqual(addOnFrom(account, '2026-02-01'), [
            ['2026-02-01', 'renewal', 10],
            ['2026-03-01', 'renewal', 8],
        ]);
    });

    test('at the start of a period prices that period on the new line, with no difference', async () => {
        const { account, booking } = await booked();
        roll(account, booking, '2026-02-01', '2026-03-01');

        await switchAt(account, booking, utc('2026-02-01'), 12);
        await account.charge(utc('2026-02-01'));

        assert.deepEqual(addOnFrom(account, '2026-02-01'), [['2026-02-01', 'renewal', 12]]);
    });

    test('prices the period it falls in on the line before it, where the journal had not charged it yet', async () => {
        const { account, booking } = await booked();
        roll(account, booking, '2026-02-01', '2026-03-01');

        await switchAt(account, booking, utc('2026-02-15'), 12);
        await account.charge(utc('2026-02-20'));

        assert.deepEqual(addOnFrom(account, '2026-02-01'), [
            ['2026-02-01', 'renewal', 10],
            ['2026-02-15', 'bundleChange', 1],
        ]);
    });

    test('is charged the difference once, however often the account is brought up to date', async () => {
        const { account, booking } = await booked();
        roll(account, booking, '2026-02-01', '2026-03-01');
        await account.charge(utc('2026-02-01'));
        await switchAt(account, booking, utc('2026-02-15'), 12);

        await account.charge(utc('2026-02-15'));
        await account.charge(utc('2026-02-20'));

        assert.deepEqual(
            addOnFrom(account, '2026-02-15').filter(([, origin]) => origin === 'bundleChange'),
            [['2026-02-15', 'bundleChange', 1]],
        );
    });

    test('charges no difference for a contract written again later without the switch’s mark', async () => {
        const { account, booking } = await booked();
        roll(account, booking, '2026-02-01', '2026-03-01');
        await account.charge(utc('2026-02-01'));
        // A change of plan prices the add-on anew at 12, with no switch behind it.
        await account.supersede(utc('2026-02-15'));
        await account.contract({
            effectiveFrom: utc('2026-02-15'),
            lineItems: [standard(), line('bundle', 'ARCHIVE', 12, { sourceVersionId: V1 })],
        });

        await account.charge(utc('2026-02-20'));

        assert.deepEqual(addOnFrom(account, '2026-02-01'), [['2026-02-01', 'renewal', 10]]);
    });
});

// @requirement SC-BUN-059 — A switch taken for the end of a booking's term is made at that moment
describe('a switch taken for the end of the term', () => {
    const theEnd = utc('2026-03-01');

    /** February charged, the switch to v2 at 12 scheduled for 1 March, and March's window open. */
    async function scheduled(bookingOverrides = {}) {
        const { account, booking } = await booked({
            pendingBundleVersionId: V2,
            pendingVersionEffectiveAt: theEnd,
            ...bookingOverrides,
        });
        roll(account, booking, '2026-02-01', '2026-03-01');
        await account.charge(utc('2026-02-01'));
        roll(account, booking, '2026-03-01', '2026-04-01');
        return { account, booking };
    }

    /** The run, late on `at`: the booking on v2, its contract marked, the schedule cleared. */
    async function madeOn(account, booking, at, moment = theEnd) {
        booking.bundleVersionId = V2;
        await account.supersede(at);
        await account.contract({
            effectiveFrom: at,
            lineItems: [standard(), archive2(12, moment)],
        });
        booking.pendingBundleVersionId = null;
        booking.pendingVersionEffectiveAt = null;
    }

    test('charges no period from its moment until the switch is made', async () => {
        const { account } = await scheduled();

        await account.charge(utc('2026-03-02'));

        assert.deepEqual(addOnFrom(account, '2026-03-01'), []);
    });

    test('prices the period from its moment on the new line, however late the run came', async () => {
        const { account, booking } = await scheduled();
        await account.charge(utc('2026-03-02'));

        await madeOn(account, booking, utc('2026-03-03'));
        await account.charge(utc('2026-03-03'));

        assert.deepEqual(addOnFrom(account, '2026-03-01'), [['2026-03-01', 'renewal', 12]]);
    });

    test('prices it so while the run has moved the booking and not yet cleared the schedule', async () => {
        const { account, booking } = await scheduled();

        await madeOn(account, booking, utc('2026-03-03'));
        booking.pendingBundleVersionId = V2;
        booking.pendingVersionEffectiveAt = theEnd;
        await account.charge(utc('2026-03-03'));

        assert.deepEqual(addOnFrom(account, '2026-03-01'), [['2026-03-01', 'renewal', 12]]);
    });

    test('charges the difference from a moment inside a period, where the new version is dearer', async () => {
        const inside = utc('2026-02-15');
        const { account, booking } = await booked({
            pendingBundleVersionId: V2,
            pendingVersionEffectiveAt: inside,
        });
        roll(account, booking, '2026-02-01', '2026-03-01');
        await account.charge(utc('2026-02-01'));

        await madeOn(account, booking, utc('2026-02-16'), inside);
        await account.charge(utc('2026-02-16'));

        assert.deepEqual(addOnFrom(account, '2026-02-01'), [
            ['2026-02-01', 'renewal', 10],
            ['2026-02-15', 'bundleChange', 1],
        ]);
    });

    test('charges a booking that ended before the switch was made at the version it ran on', async () => {
        const { account } = await scheduled({
            canceledAt: utc('2026-02-10'),
            canceledEffectiveAt: utc('2026-03-15'),
        });

        await account.charge(utc('2026-03-20'));

        assert.deepEqual(addOnFrom(account, '2026-03-01'), [['2026-03-01', 'renewal', 10]]);
    });
});

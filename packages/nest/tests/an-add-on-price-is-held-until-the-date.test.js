// What a booking pays after switching early to a dearer replacement: the
// replacement at its own price, with the difference taken off each of its
// periods until the date it was told.
//
// Every case goes through `SubscriberChargeService.recordDueCharges` over a
// monthly subscription at 49 with Archive v1 booked monthly at 10 from
// 1 January, retired onto v2 at 12 from 1 April; the booking switches on
// 15 February.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { anAccount, line, utc } from './helpers/charge-journal.js';

const RETIRED = 'bv-archive';
const REPLACEMENT = 'bv-archive-2';
const TOLD = utc('2026-04-01');
const SWITCHED = utc('2026-02-15');
/** The booking that switches: the account's first. */
const SWITCHING = 'booking-1';

const standard = () => line('plan', 'STANDARD', 49, { sourceVersionId: 'pv-standard' });
const archive = () => line('bundle', 'ARCHIVE', 10, { sourceVersionId: RETIRED });
const replacement = (marked = true) =>
    line('bundle', 'ARCHIVE', 12, {
        sourceVersionId: REPLACEMENT,
        metadata: marked ? { retirementId: 'bret-1' } : null,
    });
/** The discount line a switch writes: 2 a month off the replacement until the date. */
const held = (overrides = {}) =>
    line('discount', 'retirement-hold:bret-1', -2, {
        metadata: {
            generated: true,
            source: 'retirement',
            priceHold: {
                retirementId: 'bret-1',
                subscriptionBundleId: SWITCHING,
                bundleVersionId: REPLACEMENT,
                until: TOLD.toISOString(),
                resolvedAmountNet: 2,
            },
        },
        ...overrides,
    });

/**
 * An account told of the retirement whose booking switched on 15 February —
 * its February charged before the switch, unless `chargedFebruary` is false.
 */
async function switchedEarly({ hold = held(), chargedFebruary = true } = {}) {
    const account = anAccount();
    await account.contract({ lineItems: [standard(), archive()] });
    const booking = account.book({
        startedAt: utc('2026-01-01'),
        currentPeriodStart: utc('2026-01-01'),
        currentPeriodEnd: utc('2026-02-01'),
        createdAt: utc('2026-01-01'),
    });
    account.toldOfAddOnRetirement(booking.id, {
        retired: RETIRED,
        replacement: REPLACEMENT,
        effectiveAt: TOLD,
    });
    await account.charge(utc('2026-01-10'));
    roll(account, booking, '2026-02-01', '2026-03-01');
    if (chargedFebruary) await account.charge(utc('2026-02-01'));
    booking.bundleVersionId = REPLACEMENT;
    await account.supersede(SWITCHED);
    await account.contract({
        effectiveFrom: SWITCHED,
        lineItems: [standard(), replacement(), ...(hold ? [hold] : [])],
    });
    return { account, booking };
}

/** A contract written on 20 February in place of the switch's, as a change of plan writes one. */
async function writtenInBetween(account, lineItems) {
    await account.supersede(utc('2026-02-20'));
    await account.contract({ effectiveFrom: utc('2026-02-20'), lineItems });
}

/** The contract a change to PRO writes, where the replacement costs `price`. */
const onPro = (price) => [
    line('plan', 'PRO', 99, { sourceVersionId: 'pv-pro' }),
    line('bundle', 'ARCHIVE', price, { sourceVersionId: REPLACEMENT }),
];

/** Moves the plan's window and the booking's, as a renewal job does. */
function roll(account, booking, start, end) {
    account.roll(utc(start), utc(end));
    booking.currentPeriodStart = utc(start);
    booking.currentPeriodEnd = utc(end);
}

/** The charges of March and April, as `[period start, source, amount]`. */
async function marchAndApril(account, booking) {
    roll(account, booking, '2026-03-01', '2026-04-01');
    await account.charge(utc('2026-03-01'));
    roll(account, booking, '2026-04-01', '2026-05-01');
    await account.charge(utc('2026-04-01'));
    return account
        .entries()
        .filter(([day, source]) => day >= '2026-03-01' && source !== 'plan')
        .map(([day, source, , amount]) => [day, source, amount]);
}

// @requirement SC-BUN-055 — An early switch to a dearer replacement holds the add-on's price until the date
describe('the price held after an early switch', () => {
    test('comes off each period on the replacement that starts before the date, and none after', async () => {
        const { account, booking } = await switchedEarly();

        assert.deepEqual(await marchAndApril(account, booking), [
            ['2026-03-01', 'bundle', 12],
            ['2026-03-01', 'discount', -2],
            ['2026-04-01', 'bundle', 12],
        ]);
    });

    test('leaves February as it was charged before the switch', async () => {
        const { account } = await switchedEarly();

        await account.charge(utc('2026-02-20'));

        assert.deepEqual(
            account
                .entries()
                .filter(([day, source]) => day === '2026-02-01' && source !== 'plan')
                .map(([day, source, , amount]) => [day, source, amount]),
            [['2026-02-01', 'bundle', 10]],
        );
    });

    test('takes nothing off a period priced at the version left, though charged after the switch', async () => {
        const { account } = await switchedEarly({ chargedFebruary: false });

        await account.charge(utc('2026-02-20'));

        assert.deepEqual(
            account
                .entries()
                .filter(([day, source]) => day === '2026-02-01' && source !== 'plan')
                .map(([day, source, , amount]) => [day, source, amount]),
            [['2026-02-01', 'bundle', 10]],
        );
    });

    test('holds where a contract written in between carries no hold', async () => {
        const { account, booking } = await switchedEarly();
        await writtenInBetween(account, [standard(), replacement(false)]);

        assert.deepEqual(await marchAndApril(account, booking), [
            ['2026-03-01', 'bundle', 12],
            ['2026-03-01', 'discount', -2],
            ['2026-04-01', 'bundle', 12],
        ]);
    });

    test('takes off the difference agreed at the switch where a change of plan prices the add-on anew', async () => {
        const { account, booking } = await switchedEarly();
        await writtenInBetween(account, onPro(20));

        assert.deepEqual(await marchAndApril(account, booking), [
            ['2026-03-01', 'bundle', 20],
            ['2026-03-01', 'discount', -2],
            ['2026-04-01', 'bundle', 20],
        ]);
    });

    test('takes off no more than the period costs', async () => {
        const { account, booking } = await switchedEarly();
        await writtenInBetween(account, onPro(1));

        assert.deepEqual(await marchAndApril(account, booking), [
            ['2026-03-01', 'bundle', 1],
            ['2026-03-01', 'discount', -1],
            ['2026-04-01', 'bundle', 1],
        ]);
    });

    test('takes nothing off a later booking of the add-on, which agreed to no hold', async () => {
        const { account, booking } = await switchedEarly();
        // The booking that switched ends with February, and the add-on is
        // booked again on the replacement from March.
        booking.canceledAt = utc('2026-02-16');
        booking.canceledEffectiveAt = utc('2026-03-01');
        account.book({
            bundleVersionId: REPLACEMENT,
            startedAt: utc('2026-03-01'),
            currentPeriodStart: utc('2026-03-01'),
            currentPeriodEnd: utc('2026-04-01'),
            createdAt: utc('2026-03-01'),
        });
        account.roll(utc('2026-03-01'), utc('2026-04-01'));

        await account.charge(utc('2026-03-01'));

        assert.deepEqual(
            account
                .entries()
                .filter(([day, source]) => day === '2026-03-01' && source !== 'plan')
                .map(([day, source, , amount]) => [day, source, amount]),
            [['2026-03-01', 'bundle', 12]],
        );
    });

    test('takes nothing off a period in another rhythm than it was agreed in', async () => {
        const { account, booking } = await switchedEarly({
            hold: held({ billingCycle: 'yearly' }),
        });

        assert.deepEqual(await marchAndApril(account, booking), [
            ['2026-03-01', 'bundle', 12],
            ['2026-04-01', 'bundle', 12],
        ]);
    });
});

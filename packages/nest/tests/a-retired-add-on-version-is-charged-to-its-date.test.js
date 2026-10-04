// What a booking pays around an add-on retirement: up to the date it was told,
// the version it was on; from that date, the replacement — however late the
// move to it is written.
//
// Every case goes through `SubscriberChargeService.recordDueCharges` over a
// monthly subscription at 49 with Archive v1 booked monthly at 10 from
// 1 January, retired onto v2 at 12 from 1 April.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { anAccount, line, utc } from './helpers/charge-journal.js';

const RETIRED = 'bv-archive';
const REPLACEMENT = 'bv-archive-2';
const TOLD = utc('2026-04-01');

const standard = () => line('plan', 'STANDARD', 49, { sourceVersionId: 'pv-standard' });
const archive = () => line('bundle', 'ARCHIVE', 10, { sourceVersionId: RETIRED });
/** The add-on line a move writes: the replacement at 12, marked with the retirement. */
const replacement = (overrides = {}) =>
    line('bundle', 'ARCHIVE', 12, {
        sourceVersionId: REPLACEMENT,
        metadata: { retirementId: 'bret-1' },
        ...overrides,
    });
const at = (iso) => new Date(iso);

/**
 * An account charged through `chargedThrough` with Archive v1 booked, its
 * booking told it moves on 1 April — or, with `{ delivered: false }`, whose
 * notice of it reached nobody.
 */
async function toldOfAnAddOnRetirement({ delivered = true, chargedThrough = '2026-03-01' } = {}) {
    const account = anAccount();
    await account.contract({ lineItems: [standard(), archive()] });
    const booking = account.book({
        startedAt: utc('2026-01-01'),
        currentPeriodStart: utc('2026-01-01'),
        currentPeriodEnd: utc('2026-02-01'),
        createdAt: utc('2026-01-01'),
    });
    account.toldOfAddOnRetirement(
        booking.id,
        { retired: RETIRED, replacement: REPLACEMENT, effectiveAt: TOLD },
        { delivered },
    );
    await account.charge(utc('2026-01-10'));
    for (const [start, end] of [
        ['2026-02-01', '2026-03-01'],
        ['2026-03-01', '2026-04-01'],
    ]) {
        if (start > chargedThrough) break;
        roll(account, booking, start, end);
        await account.charge(utc(start));
    }
    return { account, booking };
}

/** Moves the plan's window and the booking's, as a renewal job does. */
function roll(account, booking, start, end) {
    account.roll(utc(start), utc(end));
    booking.currentPeriodStart = utc(start);
    booking.currentPeriodEnd = utc(end);
}

/** The move as the run makes it: the booking on the replacement, and its contract. */
async function move(account, booking, when, lines = [standard(), replacement()]) {
    booking.bundleVersionId = REPLACEMENT;
    await account.supersede(when);
    await account.contract({ effectiveFrom: when, lineItems: lines });
}

const addOnEntries = (account) => account.entries().filter(([, source]) => source === 'bundle');

// @requirement SC-BUN-050 — A booking's move and its contract are one, and its periods from the date wait for both
describe('a booking’s period from the date it was told', () => {
    test('waits while the booking is on the version retired, and is charged at the replacement from the move', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement();
        roll(account, booking, '2026-04-01', '2026-05-01');

        await account.charge(at('2026-04-01T00:05:00.000Z'));
        const waited = addOnEntries(account).length;
        await move(account, booking, at('2026-04-01T00:15:00.000Z'));
        await account.charge(at('2026-04-01T00:20:00.000Z'));

        assert.equal(waited, 3, 'nothing charged from the version retired in April');
        assert.deepEqual(addOnEntries(account), [
            ['2026-01-01', 'bundle', 'bundleBooking', 10],
            ['2026-02-01', 'bundle', 'renewal', 10],
            ['2026-03-01', 'bundle', 'renewal', 10],
            ['2026-04-01', 'bundle', 'renewal', 12],
        ]);
        assert.ok(
            account
                .entries()
                .some(
                    ([day, source, , amount]) =>
                        day === '2026-04-01' && source === 'plan' && amount === 49,
                ),
            'the plan is charged in April as before',
        );
    });

    test('is charged from a move written after it ended, and so is every period in between', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement();
        roll(account, booking, '2026-04-01', '2026-05-01');
        await account.charge(TOLD);
        roll(account, booking, '2026-05-01', '2026-06-01');
        await account.charge(utc('2026-05-01'));

        await move(account, booking, at('2026-05-10T00:00:00.000Z'));
        await account.charge(at('2026-05-10T00:05:00.000Z'));

        assert.deepEqual(addOnEntries(account).slice(3), [
            ['2026-04-01', 'bundle', 'renewal', 12],
            ['2026-05-01', 'bundle', 'renewal', 12],
        ]);
    });

    test('is not charged from a contract written on the version retired in between', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement();
        roll(account, booking, '2026-04-01', '2026-05-01');
        await account.supersede(at('2026-04-01T00:05:00.000Z'));
        await account.contract({
            effectiveFrom: at('2026-04-01T00:05:00.000Z'),
            lineItems: [standard(), archive()],
        });
        await account.charge(at('2026-04-01T00:06:00.000Z'));
        await move(account, booking, at('2026-04-01T00:15:00.000Z'));
        await account.charge(at('2026-04-01T00:20:00.000Z'));

        assert.deepEqual(addOnEntries(account).slice(3), [['2026-04-01', 'bundle', 'renewal', 12]]);
    });

    test('a period before the date is charged at the version retired, though charged after the move', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement({
            chargedThrough: '2026-02-01',
        });
        roll(account, booking, '2026-03-01', '2026-04-01');
        // March is not charged before the move; April is the replacement's.
        roll(account, booking, '2026-04-01', '2026-05-01');
        await move(account, booking, at('2026-04-01T00:15:00.000Z'));
        await account.charge(at('2026-04-01T00:20:00.000Z'));

        assert.deepEqual(addOnEntries(account).slice(2), [
            ['2026-03-01', 'bundle', 'renewal', 10],
            ['2026-04-01', 'bundle', 'renewal', 12],
        ]);
    });

    test('is charged at the version retired where the booking ended before any move came', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement();
        roll(account, booking, '2026-04-01', '2026-05-01');
        // Cancelled in April to end with it; no run moves it before then.
        booking.canceledAt = utc('2026-04-10');
        booking.canceledEffectiveAt = utc('2026-05-01');

        await account.charge(at('2026-04-15T00:00:00.000Z'));
        const waited = addOnEntries(account).length;
        await account.charge(at('2026-05-01T00:05:00.000Z'));

        assert.equal(waited, 3, 'April waits while a move can still come');
        assert.deepEqual(addOnEntries(account).slice(3), [['2026-04-01', 'bundle', 'renewal', 10]]);
    });

    test('is charged from the move’s line where the booking ended after a late move', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement();
        roll(account, booking, '2026-04-01', '2026-05-01');
        await account.charge(TOLD);
        roll(account, booking, '2026-05-01', '2026-06-01');
        await move(account, booking, at('2026-05-10T00:00:00.000Z'));
        // Cancelled before anything charged what waited, to end with May.
        booking.canceledAt = utc('2026-05-10');
        booking.canceledEffectiveAt = utc('2026-06-01');

        await account.charge(at('2026-06-01T00:05:00.000Z'));

        assert.deepEqual(addOnEntries(account).slice(3), [
            ['2026-04-01', 'bundle', 'renewal', 12],
            ['2026-05-01', 'bundle', 'renewal', 12],
        ]);
    });

    test('and so where the subscription it belongs to ended before any move came', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement();
        roll(account, booking, '2026-04-01', '2026-05-01');
        account.subscription.canceledAt = utc('2026-04-10');
        account.subscription.canceledEffectiveAt = utc('2026-05-01');

        await account.charge(at('2026-04-15T00:00:00.000Z'));
        const waited = addOnEntries(account).length;
        await account.charge(at('2026-05-01T00:05:00.000Z'));

        assert.equal(waited, 3);
        assert.deepEqual(addOnEntries(account).slice(3), [['2026-04-01', 'bundle', 'renewal', 10]]);
    });

    test('waits for nothing in another booking on the version, which the notice did not reach', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement();
        roll(account, booking, '2026-04-01', '2026-05-01');
        const other = account.book({
            startedAt: utc('2026-04-01'),
            currentPeriodStart: utc('2026-04-01'),
            currentPeriodEnd: utc('2026-05-01'),
            createdAt: utc('2026-04-01'),
        });

        await account.charge(at('2026-04-01T00:05:00.000Z'));

        assert.deepEqual(
            account.ledger.rows
                .filter((row) => row.sourceRef === other.id)
                .map((row) => [row.periodStart.toISOString().slice(0, 10), row.amountNet]),
            [['2026-04-01', 10]],
        );
        assert.equal(addOnEntries(account).length, 4, 'the booking told waits; the other does not');
    });

    test('is charged as before where the notice reached nobody: nothing moves it', async () => {
        const { account, booking } = await toldOfAnAddOnRetirement({ delivered: false });
        roll(account, booking, '2026-04-01', '2026-05-01');

        await account.charge(at('2026-04-01T00:05:00.000Z'));

        assert.deepEqual(addOnEntries(account).slice(3), [['2026-04-01', 'bundle', 'renewal', 10]]);
    });
});

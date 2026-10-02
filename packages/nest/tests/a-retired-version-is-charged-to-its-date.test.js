// What a subscription pays around a retirement: up to the date it was told, the
// version it was on; from that date, the replacement — however late the move
// to it is written — and, after a free switch to a dearer replacement, no more
// than it paid before until that date.
//
// Every case goes through `SubscriberChargeService.recordDueCharges` over a
// monthly subscription at 49 on version `pv-standard`, whose window a test
// rolls the way a renewal job does.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { ARCHIVE, anAccount, line, utc } from './helpers/charge-journal.js';

const RETIRED = 'pv-standard';
const REPLACEMENT = 'pv-next';
const TOLD = utc('2026-04-01');

const standard = () => line('plan', 'STANDARD', 49, { sourceVersionId: RETIRED });
/** The plan line a retirement writes: the replacement at `priceNet`, marked with the retirement. */
const replacement = (priceNet, overrides = {}) =>
    line('plan', 'STANDARD', priceNet, {
        sourceVersionId: REPLACEMENT,
        metadata: { retirementId: 'ret-1' },
        ...overrides,
    });
/** The price a switch holds, for the difference, until the date the subscriber was told. */
const held = (amountNet, until) =>
    line('discount', 'retirement-hold:ret-1', -amountNet, {
        metadata: {
            generated: true,
            source: 'retirement',
            priceHold: {
                retirementId: 'ret-1',
                planVersionId: REPLACEMENT,
                until: until.toISOString(),
                resolvedAmountNet: amountNet,
            },
        },
    });

const at = (iso) => new Date(iso);

/** An account charged through March on the retired version, told it moves on 1 April. */
async function toldOfARetirement(lines = [standard()]) {
    const account = anAccount();
    await account.contract({ lineItems: lines });
    account.toldOfRetirement(RETIRED, TOLD);
    await account.charge(utc('2026-01-10'));
    for (const [start, end] of [
        ['2026-02-01', '2026-03-01'],
        ['2026-03-01', '2026-04-01'],
    ]) {
        account.roll(utc(start), utc(end));
        await account.charge(utc(start));
    }
    return account;
}

/** Writes a successor from `from`, the way a freeze does. */
async function successor(account, from, lineItems) {
    await account.supersede(from);
    return account.contract({ effectiveFrom: from, lineItems });
}

// @requirement SC-PRIC-062 — A period from a retirement's date is charged at the replacement's price
describe('a period from the date the subscriber was told', () => {
    test('waits while the subscription is on the version retired, and is charged from the move', async () => {
        const account = await toldOfARetirement();
        account.roll(TOLD, utc('2026-05-01'));

        const before = await account.charge(at('2026-04-01T00:05:00.000Z'));
        await successor(account, at('2026-04-01T00:15:00.000Z'), [replacement(52)]);
        await account.charge(at('2026-04-01T00:20:00.000Z'));

        assert.deepEqual(before, [], 'nothing charged from the version retired');
        assert.deepEqual(account.entries(), [
            ['2026-01-01', 'plan', 'activation', 49],
            ['2026-02-01', 'plan', 'renewal', 49],
            ['2026-03-01', 'plan', 'renewal', 49],
            ['2026-04-01', 'plan', 'renewal', 52],
        ]);
    });

    test('is charged from a move written after it ended, and so is every period in between', async () => {
        const account = await toldOfARetirement();
        account.roll(TOLD, utc('2026-05-01'));
        await account.charge(TOLD);
        account.roll(utc('2026-05-01'), utc('2026-06-01'));
        await account.charge(utc('2026-05-01'));

        await successor(account, at('2026-05-10T00:00:00.000Z'), [replacement(45)]);
        await account.charge(at('2026-05-10T00:05:00.000Z'));

        assert.deepEqual(account.entries().slice(3), [
            ['2026-04-01', 'plan', 'renewal', 45],
            ['2026-05-01', 'plan', 'renewal', 45],
        ]);
    });

    test('is not charged from a contract an application wrote on the version retired in between', async () => {
        const account = await toldOfARetirement();
        account.roll(TOLD, utc('2026-05-01'));
        await successor(account, at('2026-04-01T00:05:00.000Z'), [standard()]);
        await account.charge(at('2026-04-01T00:06:00.000Z'));
        await successor(account, at('2026-04-01T00:15:00.000Z'), [replacement(52)]);
        await account.charge(at('2026-04-01T00:20:00.000Z'));

        assert.deepEqual(account.entries().slice(3), [['2026-04-01', 'plan', 'renewal', 52]]);
    });

    test('is not priced by a change the subscriber made later, on another plan', async () => {
        const account = await toldOfARetirement();
        for (const [start, end] of [
            ['2026-04-01', '2026-05-01'],
            ['2026-05-01', '2026-06-01'],
            ['2026-06-01', '2026-07-01'],
        ]) {
            account.roll(utc(start), utc(end));
            await account.charge(utc(start));
        }
        await successor(account, utc('2026-06-20'), [
            line('plan', 'PREMIUM', 99, { sourceVersionId: 'pv-premium' }),
        ]);
        account.roll(utc('2026-07-01'), utc('2026-08-01'));
        await account.charge(utc('2026-07-01'));

        assert.deepEqual(account.entries().slice(3), [['2026-07-01', 'plan', 'renewal', 99]]);
    });

    test('leaves the add-ons the contract names to be charged as before', async () => {
        const account = await toldOfARetirement([standard(), ARCHIVE()]);
        account.book({
            startedAt: utc('2026-03-01'),
            currentPeriodStart: TOLD,
            currentPeriodEnd: utc('2026-05-01'),
        });
        account.roll(TOLD, utc('2026-05-01'));

        await account.charge(at('2026-04-01T00:05:00.000Z'));

        const april = account.entries().filter(([start]) => start === '2026-04-01');
        assert.deepEqual(april, [['2026-04-01', 'bundle', 'renewal', 10]]);
    });

    test('a period that starts before the date is the version retired’s, at its price', async () => {
        const account = await toldOfARetirement();

        assert.deepEqual(account.entries().at(-1), ['2026-03-01', 'plan', 'renewal', 49]);
    });

    test('a contract a retirement writes adds no difference inside a period the version left priced', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [standard()] });
        account.toldOfRetirement(RETIRED, utc('2026-01-15'));
        await account.charge(utc('2026-01-10'));
        await successor(account, utc('2026-01-15'), [replacement(52)]);

        await account.charge(utc('2026-01-16'));

        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 49]]);
    });
});

// @requirement SC-PRIC-063 — After a free switch to a dearer replacement, the price is held until the date
describe('the price a switch holds', () => {
    /** Switched on 20 March from 49 to a replacement at 52, held until 1 July. */
    async function switched(lines = [replacement(52), held(3, utc('2026-07-01'))]) {
        const account = anAccount();
        await account.contract({ lineItems: [standard()] });
        await account.charge(utc('2026-01-10'));
        for (const [start, end] of [
            ['2026-02-01', '2026-03-01'],
            ['2026-03-01', '2026-04-01'],
        ]) {
            account.roll(utc(start), utc(end));
            await account.charge(utc(start));
        }
        await successor(account, utc('2026-03-20'), lines);
        await account.charge(utc('2026-03-20'));
        return account;
    }

    async function chargeThrough(account, months) {
        for (const [start, end] of months) {
            account.roll(utc(start), utc(end));
            await account.charge(utc(start));
        }
    }

    const APRIL_TO_JULY = [
        ['2026-04-01', '2026-05-01'],
        ['2026-05-01', '2026-06-01'],
        ['2026-06-01', '2026-07-01'],
        ['2026-07-01', '2026-08-01'],
    ];

    test('takes the difference off each period before the date, and nothing from it', async () => {
        const account = await switched();
        await chargeThrough(account, APRIL_TO_JULY);

        assert.deepEqual(account.entries().slice(2), [
            ['2026-03-01', 'plan', 'renewal', 49],
            ['2026-04-01', 'discount', 'renewal', -3],
            ['2026-04-01', 'plan', 'renewal', 52],
            ['2026-05-01', 'discount', 'renewal', -3],
            ['2026-05-01', 'plan', 'renewal', 52],
            ['2026-06-01', 'discount', 'renewal', -3],
            ['2026-06-01', 'plan', 'renewal', 52],
            ['2026-07-01', 'plan', 'renewal', 52],
        ]);
    });

    test('stays where it was agreed when a contract is written again before the date', async () => {
        const account = await switched();
        await chargeThrough(account, APRIL_TO_JULY.slice(0, 1));
        await successor(account, utc('2026-04-15'), [replacement(52, { metadata: null })]);
        await chargeThrough(account, APRIL_TO_JULY.slice(1, 3));

        const discounts = account.entries().filter(([, source]) => source === 'discount');
        assert.deepEqual(
            discounts.map(([start]) => start),
            ['2026-04-01', '2026-05-01', '2026-06-01'],
        );
    });

    test('ends when the subscriber leaves the version switched to', async () => {
        const account = await switched();
        await chargeThrough(account, APRIL_TO_JULY.slice(0, 1));
        await successor(account, utc('2026-04-20'), [
            line('plan', 'BIGGER', 99, { sourceVersionId: 'pv-bigger' }),
        ]);
        await chargeThrough(account, APRIL_TO_JULY.slice(1, 2));

        const may = account.entries().filter(([start]) => start === '2026-05-01');
        assert.deepEqual(may, [['2026-05-01', 'plan', 'renewal', 99]]);
    });

    test('a cheaper replacement holds nothing: its price applies from the next period', async () => {
        const account = await switched([replacement(45)]);
        await chargeThrough(account, APRIL_TO_JULY.slice(0, 1));

        assert.deepEqual(account.entries().slice(2), [
            ['2026-03-01', 'plan', 'renewal', 49],
            ['2026-04-01', 'plan', 'renewal', 45],
        ]);
    });
});

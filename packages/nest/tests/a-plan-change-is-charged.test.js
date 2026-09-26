// What an immediate upgrade is charged, as the subscriber's account records it.
//
// The preview quotes it and the plan change writes it (`SC-CHG-020`,
// `SC-CHG-021`); the account charges the same thing, derived from the records
// the change leaves behind — the contract that takes effect mid-period, or the
// window a longer rhythm opens. April has thirty days, which keeps the
// arithmetic the one the requirements quote.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { anAccount, discountLine, line, utc } from './helpers/charge-journal.js';

const STANDARD = () => line('plan', 'STANDARD', 49);
const PRO = () => line('plan', 'PRO', 99);
const PRO_YEARLY = (priceNet = 990) => line('plan', 'PRO', priceNet, { billingCycle: 'yearly' });

/** An account on Standard at 49 a month, April charged on its first day. */
async function onStandardInApril() {
    const account = anAccount({
        subscription: {
            startedAt: utc('2026-04-01'),
            currentPeriodStart: utc('2026-04-01'),
            currentPeriodEnd: utc('2026-05-01'),
        },
    });
    await account.contract({ effectiveFrom: utc('2026-04-01'), lineItems: [STANDARD()] });
    await account.charge(utc('2026-04-01'));
    return account;
}

/** The contract an immediate change writes: the one before it ends where this begins. */
async function changedOn(account, day, lineItems, extra = {}) {
    await account.supersede(utc(day));
    return account.contract({ effectiveFrom: utc(day), lineItems, ...extra });
}

/** Moves the plan into yearly on `day`, the way the plan change writes it. */
function yearlyFrom(account, day) {
    const start = utc(day);
    const end = new Date(
        Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate()),
    );
    Object.assign(account.subscription, {
        billingCycle: 'YEARLY',
        billingAnchorDay: start.getUTCDate(),
    });
    account.roll(start, end);
    return end;
}

const planEntries = (account) =>
    account
        .entries()
        .filter(([, source]) => source === 'plan')
        .map(([start, , origin, amount]) => [start, origin, amount]);

const discountEntries = (account) =>
    account
        .entries()
        .filter(([, source]) => source === 'discount')
        .map(([start, , origin, amount]) => [start, origin, amount]);

const code = (durationType, durationValue) => ({
    code: 'WELCOME20',
    label: '20 %',
    valueType: 'PERCENT',
    value: 20,
    resolvedAmountNet: 9.8,
    durationType,
    durationValue,
});

// @requirement SC-PRIC-059 — An immediate upgrade is charged as it was quoted
describe('an immediate upgrade in the same rhythm is charged the difference for the rest of the period', () => {
    test('Standard 49 to Pro 99 on day 15 of 30 costs 25.00 now, and the next renewal 99', async () => {
        const account = await onStandardInApril();
        const pro = await changedOn(account, '2026-04-16', [PRO()]);

        await account.charge(utc('2026-04-16'));
        account.roll(utc('2026-05-01'), utc('2026-06-01'));
        await account.charge(utc('2026-05-01'));

        assert.deepEqual(planEntries(account), [
            ['2026-04-01', 'activation', 49],
            ['2026-04-16', 'planChange', 25],
            ['2026-05-01', 'renewal', 99],
        ]);
        const difference = account.ledger.rows.find((row) => row.origin === 'planChange');
        assert.equal(difference.periodEnd.toISOString(), utc('2026-05-01').toISOString());
        assert.equal(difference.contractId, pro.id);
        assert.equal(difference.contractLineItemId, pro.lineItems[0].id);
    });

    test('a contract written again at the same price adds nothing', async () => {
        const account = await onStandardInApril();
        await changedOn(account, '2026-04-16', [STANDARD()]);

        await account.charge(utc('2026-04-16'));

        assert.deepEqual(planEntries(account), [['2026-04-01', 'activation', 49]]);
    });

    test('two upgrades in one period are each charged from the price before them', async () => {
        const account = await onStandardInApril();
        await changedOn(account, '2026-04-16', [PRO()]);
        await changedOn(account, '2026-04-24', [line('plan', 'BUSINESS', 149)]);

        await account.charge(utc('2026-04-24'));

        // 50 × 15/30, then 50 × 7/30.
        assert.deepEqual(planEntries(account), [
            ['2026-04-01', 'activation', 49],
            ['2026-04-16', 'planChange', 25],
            ['2026-04-24', 'planChange', 11.67],
        ]);
    });

    test('a contract that takes effect as the period starts prices that period, and adds nothing', async () => {
        const account = await onStandardInApril();
        await changedOn(account, '2026-05-01', [PRO()]);

        account.roll(utc('2026-05-01'), utc('2026-06-01'));
        await account.charge(utc('2026-05-01'));

        assert.deepEqual(planEntries(account), [
            ['2026-04-01', 'activation', 49],
            ['2026-05-01', 'renewal', 99],
        ]);
    });

    test('nothing before the upgrade takes effect, and nothing after the subscription has ended', async () => {
        const early = await onStandardInApril();
        await changedOn(early, '2026-04-16', [PRO()]);
        await early.charge(utc('2026-04-15'));
        assert.deepEqual(planEntries(early), [['2026-04-01', 'activation', 49]]);

        const ended = await onStandardInApril();
        Object.assign(ended.subscription, {
            canceledAt: utc('2026-04-02'),
            canceledEffectiveAt: utc('2026-04-10'),
        });
        await changedOn(ended, '2026-04-16', [PRO()]);
        await ended.charge(utc('2026-04-20'));
        assert.deepEqual(planEntries(ended), [['2026-04-01', 'activation', 49]]);
    });

    test('a second call writes the difference no second time', async () => {
        const account = await onStandardInApril();
        await changedOn(account, '2026-04-16', [PRO()]);

        await account.charge(utc('2026-04-16'));
        const again = await account.charge(utc('2026-04-20'));

        assert.deepEqual(again, []);
        assert.equal(account.ledger.rows.filter((row) => row.origin === 'planChange').length, 1);
    });
});

// @requirement SC-PRIC-059 — An immediate upgrade is charged as it was quoted
describe('an immediate upgrade into a longer rhythm is charged the new period less the unused rest', () => {
    test('Standard 49 a month to Pro 990 a year on day 15 of 30 costs 965.50, and the year after 990', async () => {
        const account = await onStandardInApril();
        const end = yearlyFrom(account, '2026-04-16');
        await changedOn(account, '2026-04-16', [PRO_YEARLY()]);

        await account.charge(utc('2026-04-16'));
        account.roll(end, utc('2028-04-16'));
        await account.charge(end);

        assert.deepEqual(planEntries(account), [
            ['2026-04-01', 'activation', 49],
            ['2026-04-16', 'planChange', 965.5],
            ['2027-04-16', 'renewal', 990],
        ]);
    });

    test('the rest is valued at the price in force just before, an upgrade earlier in the month included', async () => {
        const account = await onStandardInApril();
        await changedOn(account, '2026-04-06', [PRO()]);
        yearlyFrom(account, '2026-04-16');
        await changedOn(account, '2026-04-16', [PRO_YEARLY()]);

        await account.charge(utc('2026-04-16'));

        // 50 × 25/30 for the first change; 990 − 99 × 15/30 for the second.
        assert.deepEqual(planEntries(account), [
            ['2026-04-01', 'activation', 49],
            ['2026-04-06', 'planChange', 41.67],
            ['2026-04-16', 'planChange', 940.5],
        ]);
    });

    test('a rest larger than the new period costs nothing, and is never paid out', async () => {
        const account = await onStandardInApril();
        yearlyFrom(account, '2026-04-16');
        await changedOn(account, '2026-04-16', [PRO_YEARLY(20)]);

        await account.charge(utc('2026-04-16'));

        assert.deepEqual(planEntries(account), [
            ['2026-04-01', 'activation', 49],
            ['2026-04-16', 'planChange', 0],
        ]);
    });

    test('a second call charges the new period no second time', async () => {
        const account = await onStandardInApril();
        yearlyFrom(account, '2026-04-16');
        await changedOn(account, '2026-04-16', [PRO_YEARLY()]);

        await account.charge(utc('2026-04-16'));
        const again = await account.charge(utc('2026-05-20'));

        assert.deepEqual(again, []);
    });
});

// @requirement SC-PRIC-060 — A discount keeps to its rhythm, and what is left of it moves to the new period
describe('a discount and a plan change', () => {
    /** Standard with a code agreed on 1 April, April charged. */
    async function discountedFromApril(promoCode) {
        const account = anAccount({
            subscription: {
                startedAt: utc('2026-04-01'),
                currentPeriodStart: utc('2026-04-01'),
                currentPeriodEnd: utc('2026-05-01'),
            },
        });
        await account.contract({
            effectiveFrom: utc('2026-04-01'),
            offer: 'offer-1',
            lineItems: [STANDARD(), discountLine(9.8, { promoCode })],
        });
        await account.charge(utc('2026-04-01'));
        return account;
    }

    test('the difference carries none; the discount runs on the whole periods for its duration', async () => {
        const account = await discountedFromApril(code('MONTHS', 3));
        await changedOn(account, '2026-04-16', [PRO()]);
        await account.charge(utc('2026-04-16'));
        for (const month of [4, 5, 6]) {
            account.roll(
                new Date(Date.UTC(2026, month, 1)),
                new Date(Date.UTC(2026, month + 1, 1)),
            );
            await account.charge(new Date(Date.UTC(2026, month, 1)));
        }

        assert.deepEqual(discountEntries(account), [
            ['2026-04-01', 'activation', -9.8],
            ['2026-05-01', 'renewal', -9.8],
            ['2026-06-01', 'renewal', -9.8],
        ]);
        assert.deepEqual(planEntries(account).slice(0, 3), [
            ['2026-04-01', 'activation', 49],
            ['2026-04-16', 'planChange', 25],
            ['2026-05-01', 'renewal', 99],
        ]);
    });

    test('an upgrade offer with its own code mid-period: the difference now, the code from the next period', async () => {
        const account = await onStandardInApril();
        await changedOn(
            account,
            '2026-04-16',
            [PRO(), discountLine(9.8, { promoCode: code('ONCE', null) })],
            {
                offer: 'offer-upgrade',
            },
        );

        await account.charge(utc('2026-04-16'));
        account.roll(utc('2026-05-01'), utc('2026-06-01'));
        await account.charge(utc('2026-05-01'));

        assert.deepEqual(planEntries(account), [
            ['2026-04-01', 'activation', 49],
            ['2026-04-16', 'planChange', 25],
            ['2026-05-01', 'renewal', 99],
        ]);
        assert.deepEqual(discountEntries(account), [['2026-05-01', 'renewal', -9.8]]);
    });

    test('into a longer rhythm, the months left of a code are taken off the new period', async () => {
        const account = await discountedFromApril(code('MONTHS', 3));
        yearlyFrom(account, '2026-04-16');
        await changedOn(account, '2026-04-16', [PRO_YEARLY()]);

        await account.charge(utc('2026-04-16'));

        // April had its share; May and June are left.
        assert.deepEqual(discountEntries(account), [
            ['2026-04-01', 'activation', -9.8],
            ['2026-04-16', 'planChange', -19.6],
        ]);
    });

    test('the billing periods left are carried, and a one-off code that was used carries nothing', async () => {
        const cycles = await discountedFromApril(code('BILLING_CYCLES', 2));
        yearlyFrom(cycles, '2026-04-16');
        await changedOn(cycles, '2026-04-16', [PRO_YEARLY()]);
        await cycles.charge(utc('2026-04-16'));
        assert.deepEqual(discountEntries(cycles), [
            ['2026-04-01', 'activation', -9.8],
            ['2026-04-16', 'planChange', -9.8],
        ]);

        const once = await discountedFromApril(code('ONCE', null));
        yearlyFrom(once, '2026-04-16');
        await changedOn(once, '2026-04-16', [PRO_YEARLY()]);
        await once.charge(utc('2026-04-16'));
        assert.deepEqual(discountEntries(once), [['2026-04-01', 'activation', -9.8]]);
    });

    test('what is carried takes no more off than the new period costs', async () => {
        const account = await discountedFromApril(code('MONTHS', 12));
        yearlyFrom(account, '2026-04-16');
        await changedOn(account, '2026-04-16', [PRO_YEARLY(60)]);

        await account.charge(utc('2026-04-16'));

        // 60 − 49 × 15/30 = 35.50 for the year; eleven months left would be 107.80.
        assert.deepEqual(planEntries(account)[1], ['2026-04-16', 'planChange', 35.5]);
        assert.deepEqual(discountEntries(account)[1], ['2026-04-16', 'planChange', -35.5]);
    });

    test('a code concluded with the change takes the new period as its first', async () => {
        const account = await onStandardInApril();
        yearlyFrom(account, '2026-04-16');
        await changedOn(
            account,
            '2026-04-16',
            [
                PRO_YEARLY(),
                // An offer for the yearly plan writes its discount line yearly.
                {
                    ...discountLine(99, {
                        promoCode: { ...code('ONCE', null), resolvedAmountNet: 99 },
                    }),
                    billingCycle: 'yearly',
                },
            ],
            { offer: 'offer-yearly' },
        );

        await account.charge(utc('2026-04-16'));

        assert.deepEqual(discountEntries(account), [['2026-04-16', 'planChange', -99]]);
    });

    test('a discount carried into a longer rhythm does not come back when the rhythm returns', async () => {
        const account = await discountedFromApril(code('MONTHS', 24));
        const end = yearlyFrom(account, '2026-04-16');
        await changedOn(account, '2026-04-16', [PRO_YEARLY()]);
        await account.charge(utc('2026-04-16'));

        // A year on, the move back to monthly the term allows.
        Object.assign(account.subscription, { billingCycle: 'MONTHLY', billingAnchorDay: 16 });
        await changedOn(account, '2027-04-16', [STANDARD()]);
        account.roll(end, utc('2027-05-16'));
        await account.charge(end);

        // Twenty-three months were carried; none of them twice.
        assert.deepEqual(discountEntries(account), [
            ['2026-04-01', 'activation', -9.8],
            ['2026-04-16', 'planChange', -225.4],
        ]);
    });

    test('a return to monthly takes what is left of a yearly discount off the first month, once', async () => {
        const account = anAccount({
            subscription: {
                billingCycle: 'YEARLY',
                startedAt: utc('2026-04-01'),
                currentPeriodStart: utc('2026-04-01'),
                currentPeriodEnd: utc('2027-04-01'),
            },
        });
        await account.contract({
            effectiveFrom: utc('2026-04-01'),
            offer: 'offer-yearly',
            lineItems: [
                PRO_YEARLY(),
                {
                    ...discountLine(99, {
                        promoCode: { ...code('BILLING_CYCLES', 2), resolvedAmountNet: 99 },
                    }),
                    billingCycle: 'yearly',
                },
            ],
        });
        await account.charge(utc('2026-04-01'));

        Object.assign(account.subscription, { billingCycle: 'MONTHLY' });
        await changedOn(account, '2027-04-01', [STANDARD()]);
        account.roll(utc('2027-04-01'), utc('2027-05-01'));
        await account.charge(utc('2027-04-01'));
        account.roll(utc('2027-05-01'), utc('2027-06-01'));
        await account.charge(utc('2027-05-01'));

        // One yearly share of 99 was left; the first month costs 49.
        assert.deepEqual(discountEntries(account), [
            ['2026-04-01', 'activation', -99],
            ['2027-04-01', 'renewal', -49],
        ]);
    });

    test('a discount from the old rhythm takes nothing off the yearly renewals after the change', async () => {
        const account = await discountedFromApril(code('MONTHS', 24));
        const end = yearlyFrom(account, '2026-04-16');
        await changedOn(account, '2026-04-16', [PRO_YEARLY()]);
        await account.charge(utc('2026-04-16'));

        account.roll(end, utc('2028-04-16'));
        await account.charge(end);

        assert.deepEqual(
            discountEntries(account).map(([start, origin]) => [start, origin]),
            [
                ['2026-04-01', 'activation'],
                ['2026-04-16', 'planChange'],
            ],
        );
    });
});

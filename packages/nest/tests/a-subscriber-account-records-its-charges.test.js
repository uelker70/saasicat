// A subscriber's account records the charges its contracts give rise to.
//
// Every case goes through `SubscriberChargeService.recordDueCharges`, the one
// call an application makes, over a subscription whose window a test moves the
// way a renewal job does — so what is asserted is what an operator would find
// in the account, not what a helper returns.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SubscriberChargeService, TenantBillingModule } from '../dist/billing/index.js';
import { ARCHIVE, anAccount, discountLine, line, utc } from './helpers/charge-journal.js';

const STANDARD = () => line('plan', 'STANDARD', 49);

// @requirement SC-PRIC-053 — A charge is written once for its contract line and period, however often it is derived
describe('a charge is written once', () => {
    test('a second call writes nothing, and says so', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });

        const first = await account.charge(utc('2026-01-10'));
        const again = await account.charge(utc('2026-01-20'));

        assert.equal(first.length, 1);
        assert.deepEqual(again, []);
        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 49]]);
    });

    test('calls at the same moment write it once between them', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });

        const results = await Promise.all([1, 2, 3].map(() => account.charge(utc('2026-01-10'))));

        assert.equal(results.flat().length, 1);
        assert.equal(account.ledger.rows.length, 1);
    });
});

// @requirement SC-PRIC-054 — Every period of a subscription is charged, at the price in force when it starts
// @requirement SC-AUD-011 — A charge carries the period it belongs to
// @requirement SC-AUD-017 — Every charge names the contract line it came from
describe('every period is charged, at the price in force when it starts', () => {
    test('the first period is the activation, the next a renewal, each for its own period', async () => {
        const account = anAccount();
        const contract = await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));

        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        await account.charge(utc('2026-02-01'));

        assert.deepEqual(account.entries(), [
            ['2026-01-01', 'plan', 'activation', 49],
            ['2026-02-01', 'plan', 'renewal', 49],
        ]);
        const [january] = account.ledger.rows;
        assert.equal(january.periodEnd.toISOString(), utc('2026-02-01').toISOString());
        assert.equal(january.contractId, contract.id);
        assert.equal(january.contractLineItemId, contract.lineItems[0].id);
        assert.equal(january.subscriberId, 'subscriber-1');
        assert.equal(january.currency, 'EUR');
    });

    test('periods a renewal skipped are charged one by one, from where the account left off', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));

        // The renewal job did not run in February or March.
        account.roll(utc('2026-04-01'), utc('2026-05-01'));
        await account.charge(utc('2026-04-02'));

        assert.deepEqual(
            account.entries().map(([start, , origin]) => [start, origin]),
            [
                ['2026-01-01', 'activation'],
                ['2026-02-01', 'renewal'],
                ['2026-03-01', 'renewal'],
                ['2026-04-01', 'renewal'],
            ],
        );
    });

    test('a later price applies to the periods that start under it, not before', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));
        await account.supersede(utc('2026-03-01'));
        await account.contract({
            effectiveFrom: utc('2026-03-01'),
            lineItems: [line('plan', 'STANDARD', 59)],
        });

        account.roll(utc('2026-03-01'), utc('2026-04-01'));
        await account.charge(utc('2026-03-02'));

        assert.deepEqual(
            account.entries().map(([start, , , amount]) => [start, amount]),
            [
                ['2026-01-01', 49],
                ['2026-02-01', 49],
                ['2026-03-01', 59],
            ],
        );
    });

    test('a window opened a moment before its contract is still charged under it', async () => {
        // Onboarding opens the window and freezes the contract right after,
        // and records no start of its own.
        const account = anAccount({ subscription: { startedAt: null } });
        await account.contract({
            effectiveFrom: new Date(utc('2026-01-01').getTime() + 40),
            lineItems: [STANDARD()],
        });

        await account.charge(utc('2026-01-01'));

        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 49]]);
    });

    test('a subscription older than its first charge starts with a renewal, not an activation', async () => {
        const account = anAccount({
            subscription: {
                currentPeriodStart: utc('2026-06-01'),
                currentPeriodEnd: utc('2026-07-01'),
            },
        });
        await account.contract({ effectiveFrom: utc('2025-03-01'), lineItems: [STANDARD()] });

        await account.charge(utc('2026-06-05'));

        assert.deepEqual(account.entries(), [['2026-06-01', 'plan', 'renewal', 49]]);
    });

    test('a yearly plan is charged its yearly line', async () => {
        const account = anAccount({
            subscription: { billingCycle: 'YEARLY', currentPeriodEnd: utc('2027-01-01') },
        });
        await account.contract({
            lineItems: [line('plan', 'STANDARD', 490, { billingCycle: 'yearly' })],
        });

        await account.charge(utc('2026-01-10'));

        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 490]]);
    });

    test('a contract line in another rhythm prices nothing', async () => {
        const account = anAccount();
        await account.contract({
            lineItems: [line('plan', 'STANDARD', 490, { billingCycle: 'yearly' })],
        });

        assert.deepEqual(await account.charge(utc('2026-01-10')), []);
    });
});

// @requirement SC-PRIC-055 — Nothing is charged in a trial, without a contract, early, or after the end
describe('what is not charged', () => {
    test('a trial', async () => {
        const account = anAccount({ subscription: { status: 'TRIAL' } });
        await account.contract({ lineItems: [STANDARD()] });

        assert.deepEqual(await account.charge(utc('2026-01-10')), []);
    });

    test('a subscription without a contract', async () => {
        const account = anAccount();

        assert.deepEqual(await account.charge(utc('2026-01-10')), []);
    });

    test('a tenant without a subscriber', async () => {
        const account = anAccount({ subscriber: null });
        await account.contract({ lineItems: [STANDARD()] });

        assert.deepEqual(await account.charge(utc('2026-01-10')), []);
    });

    test('a period that has not started', async () => {
        const account = anAccount({
            subscription: {
                currentPeriodStart: utc('2026-02-01'),
                currentPeriodEnd: utc('2026-03-01'),
            },
        });
        await account.contract({ lineItems: [STANDARD()] });

        assert.deepEqual(await account.charge(utc('2026-01-31')), []);
        assert.equal((await account.charge(utc('2026-02-01'))).length, 1);
    });

    test('a period starting on or after the date a cancellation takes effect', async () => {
        const account = anAccount({
            subscription: { canceledAt: utc('2026-01-15'), canceledEffectiveAt: utc('2026-02-01') },
        });
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));

        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        await account.charge(utc('2026-02-10'));

        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 49]]);
    });
});

// @requirement SC-PRIC-058 — An account begins with the current window, and nothing before it is guessed
describe('an account begins with the window its subscription is in', () => {
    test('not with a contract concluded during the trial before it', async () => {
        // Concluded at sign-up on 5 December; the trial ended on 1 January.
        const account = anAccount({ subscription: { trialEndsAt: utc('2026-01-01') } });
        await account.contract({ effectiveFrom: utc('2025-12-05'), lineItems: [STANDARD()] });

        await account.charge(utc('2026-01-02'));

        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 49]]);
    });

    test('a window that moved on before anything charged it is not charged afterwards', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        // The renewal job moved the window without charging January first.
        account.roll(utc('2026-02-01'), utc('2026-03-01'));

        await account.charge(utc('2026-02-02'));

        assert.deepEqual(account.entries(), [['2026-02-01', 'plan', 'renewal', 49]]);
    });

    test('an add-on whose first charge was missed is charged from its booking', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));
        // Booked on 21 January, and nothing charged it before the windows moved on.
        account.book();
        await account.supersede(utc('2026-01-21'));
        await account.contract({
            effectiveFrom: utc('2026-01-21'),
            lineItems: [STANDARD(), ARCHIVE()],
        });
        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        account.bookings[0].currentPeriodStart = utc('2026-02-01');
        account.bookings[0].currentPeriodEnd = utc('2026-03-01');

        await account.charge(utc('2026-02-02'));

        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'bundle'),
            [
                ['2026-01-21', 'bundle', 'bundleBooking', 3.55],
                ['2026-02-01', 'bundle', 'renewal', 10],
            ],
        );
    });

    test('an add-on whose window ended before the account began is not charged', async () => {
        const account = anAccount({
            subscription: {
                currentPeriodStart: utc('2026-02-01'),
                currentPeriodEnd: utc('2026-03-01'),
            },
        });
        await account.contract({ lineItems: [STANDARD(), ARCHIVE()] });
        account.book();

        await account.charge(utc('2026-02-02'));

        assert.deepEqual(account.entries(), [['2026-02-01', 'plan', 'renewal', 49]]);
    });

    test('an add-on booked in the trial is charged from the first paid window', async () => {
        const account = anAccount({
            subscription: {
                status: 'TRIAL',
                startedAt: utc('2025-12-05'),
                trialEndsAt: utc('2026-01-01'),
                currentPeriodStart: utc('2025-12-05'),
                currentPeriodEnd: utc('2026-01-01'),
            },
        });
        await account.contract({
            effectiveFrom: utc('2025-12-05'),
            lineItems: [STANDARD(), ARCHIVE()],
        });
        account.book({
            startedAt: utc('2025-12-10'),
            currentPeriodStart: utc('2025-12-10'),
            currentPeriodEnd: utc('2026-01-01'),
        });
        assert.deepEqual(await account.charge(utc('2025-12-15')), []);

        // The trial ends: the first paid window opens, and the add-on moves beside it.
        Object.assign(account.subscription, { status: 'ACTIVE', startedAt: utc('2026-01-01') });
        account.roll(utc('2026-01-01'), utc('2026-02-01'));
        account.bookings[0].currentPeriodStart = utc('2026-01-01');
        account.bookings[0].currentPeriodEnd = utc('2026-02-01');
        await account.charge(utc('2026-01-02'));

        assert.deepEqual(account.entries(), [
            ['2026-01-01', 'bundle', 'bundleBooking', 10],
            ['2026-01-01', 'plan', 'activation', 49],
        ]);
    });
});

// @requirement SC-PRIC-056 — A charge is net, and its tax is the invoice's
describe('a charge is net', () => {
    test('it records the net amount and its currency, and no tax', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });

        const [charge] = await account.charge(utc('2026-01-10'));

        assert.equal(charge.amountNet, 49);
        assert.equal(charge.currency, 'EUR');
        for (const field of ['taxRate', 'taxAmount', 'amountGross', 'priceGross']) {
            assert.equal(field in charge, false, `a charge carries ${field}`);
        }
    });
});

// @requirement SC-PRIC-020 — A charge, once written, is never edited
describe('a written charge is never edited', () => {
    test('a contract written later changes no charge already written', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));
        await account.supersede(utc('2026-01-01'));
        await account.contract({ lineItems: [line('plan', 'STANDARD', 59)] });

        await account.charge(utc('2026-01-20'));

        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 49]]);
    });
});

// @requirement SC-BUN-003 — The first period of a booking is short, and charged for exactly that stretch
describe('an add-on is charged its short first period, then whole ones', () => {
    test('the first period for exactly that stretch of a whole month, the next in full', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));
        // The booking comes before the contract that takes it in.
        account.book();
        await account.supersede(new Date(utc('2026-01-21').getTime() + 30));
        await account.contract({
            effectiveFrom: new Date(utc('2026-01-21').getTime() + 30),
            lineItems: [STANDARD(), ARCHIVE()],
        });
        await account.charge(utc('2026-01-21'));

        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        account.bookings[0].currentPeriodStart = utc('2026-02-01');
        account.bookings[0].currentPeriodEnd = utc('2026-03-01');
        await account.charge(utc('2026-02-01'));

        const bundle = account.entries().filter(([, source]) => source === 'bundle');
        // 11 of the 31 days between 1 January and 1 February, at 10 a month.
        assert.deepEqual(bundle, [
            ['2026-01-21', 'bundle', 'bundleBooking', 3.55],
            ['2026-02-01', 'bundle', 'renewal', 10],
        ]);
    });

    test('an add-on no contract names yet is not charged, and is once one does', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        account.book();

        await account.charge(utc('2026-01-21'));
        assert.equal(account.entries().filter(([, source]) => source === 'bundle').length, 0);

        await account.supersede(utc('2026-01-22'));
        await account.contract({
            effectiveFrom: utc('2026-01-22'),
            lineItems: [STANDARD(), ARCHIVE()],
        });
        await account.charge(utc('2026-01-22'));
        assert.equal(account.entries().filter(([, source]) => source === 'bundle').length, 1);
    });

    test('a cancelled add-on is not charged from its effective date on', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD(), ARCHIVE()] });
        account.book({
            canceledAt: utc('2026-01-25'),
            canceledEffectiveAt: utc('2026-02-01'),
        });
        await account.charge(utc('2026-01-21'));

        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        account.bookings[0].currentPeriodStart = utc('2026-02-01');
        account.bookings[0].currentPeriodEnd = utc('2026-03-01');
        await account.charge(utc('2026-02-02'));

        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'bundle'),
            [['2026-01-21', 'bundle', 'bundleBooking', 3.55]],
        );
    });
});

// @requirement SC-PRIC-057 — A discount is charged for the periods it was concluded for, and no others
describe('a discount is charged for the periods it was concluded for', () => {
    async function concludedWith(discount, months = 5) {
        const account = anAccount();
        await account.contract({ offer: 'offer-1', lineItems: [STANDARD(), discount] });
        for (let month = 0; month < months; month++) {
            const start = new Date(Date.UTC(2026, month, 1));
            account.roll(start, new Date(Date.UTC(2026, month + 1, 1)));
            await account.charge(start);
        }
        return account
            .entries()
            .filter(([, source]) => source === 'discount')
            .map(([start, , , amount]) => [start, amount]);
    }
    const code = (durationType, durationValue) => ({
        code: 'WELCOME20',
        label: '20 %',
        valueType: 'PERCENT',
        value: 20,
        resolvedAmountNet: 9.8,
        durationType,
        durationValue,
    });

    test('a code for three months, in months one to three', async () => {
        assert.deepEqual(await concludedWith(discountLine(9.8, { promoCode: code('MONTHS', 3) })), [
            ['2026-01-01', -9.8],
            ['2026-02-01', -9.8],
            ['2026-03-01', -9.8],
        ]);
    });

    test('a code for two billing periods, in the first two', async () => {
        assert.deepEqual(
            await concludedWith(discountLine(9.8, { promoCode: code('BILLING_CYCLES', 2) })),
            [
                ['2026-01-01', -9.8],
                ['2026-02-01', -9.8],
            ],
        );
    });

    test('a code once, and one that names no duration, in the first period only', async () => {
        for (const once of [code('ONCE', null), code(null, null)]) {
            assert.deepEqual(await concludedWith(discountLine(9.8, { promoCode: once })), [
                ['2026-01-01', -9.8],
            ]);
        }
    });

    test('a percentage promotion, which states no duration, in the first period only', async () => {
        const promotion = {
            id: 'launch',
            type: 'percent',
            value: 20,
            label: 'Launch',
            resolvedAmountNet: 9.8,
            appliesTo: ['STANDARD'],
            billingCycle: 'both',
        };
        assert.deepEqual(await concludedWith(discountLine(9.8, { promotions: [promotion] })), [
            ['2026-01-01', -9.8],
        ]);
    });

    test('an intro price for two months, in months one and two', async () => {
        const promotion = {
            id: 'intro',
            type: 'intro',
            value: { price: 29, months: 2 },
            label: 'Intro',
            resolvedAmountNet: 20,
            appliesTo: ['STANDARD'],
            billingCycle: 'monthly',
        };
        assert.deepEqual(await concludedWith(discountLine(20, { promotions: [promotion] })), [
            ['2026-01-01', -20],
            ['2026-02-01', -20],
        ]);
    });

    test('a discount line that says nothing of its duration, once', async () => {
        assert.deepEqual(await concludedWith(line('discount', 'goodwill', -5)), [
            ['2026-01-01', -5],
        ]);
    });

    test('an offer concluded during a trial is discounted from the first paid period', async () => {
        const account = anAccount();
        await account.contract({
            effectiveFrom: utc('2025-12-05'),
            offer: 'offer-1',
            lineItems: [STANDARD(), discountLine(9.8, { promoCode: code('ONCE', null) })],
        });

        await account.charge(utc('2026-01-02'));

        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'discount'),
            [['2026-01-01', 'discount', 'activation', -9.8]],
        );
    });

    test('a contract written between the conclusion and the first paid period does not take it away', async () => {
        const account = anAccount();
        await account.contract({
            effectiveFrom: utc('2025-12-05'),
            offer: 'offer-1',
            lineItems: [STANDARD(), discountLine(9.8, { promoCode: code('ONCE', null) })],
        });
        // An add-on booked on 20 December, still in the trial, writes the contract again.
        await account.supersede(utc('2025-12-20'));
        await account.contract({
            effectiveFrom: utc('2025-12-20'),
            lineItems: [STANDARD(), ARCHIVE()],
        });

        await account.charge(utc('2026-01-02'));

        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'discount'),
            [['2026-01-01', 'discount', 'activation', -9.8]],
        );
    });

    test('an offer concluded as a period ends is discounted from the next one', async () => {
        const account = anAccount({
            subscription: {
                startedAt: utc('2025-12-01'),
                currentPeriodStart: utc('2025-12-01'),
                currentPeriodEnd: utc('2026-01-01'),
            },
        });
        await account.contract({ effectiveFrom: utc('2025-12-01'), lineItems: [STANDARD()] });
        await account.charge(utc('2025-12-02'));
        await account.supersede(utc('2026-01-01'));
        await account.contract({
            effectiveFrom: utc('2026-01-01'),
            offer: 'offer-1',
            lineItems: [STANDARD(), discountLine(9.8, { promoCode: code('ONCE', null) })],
        });

        account.roll(utc('2026-01-01'), utc('2026-02-01'));
        await account.charge(utc('2026-01-02'));

        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'discount'),
            [['2026-01-01', 'discount', 'renewal', -9.8]],
        );
    });

    test('an offer concluded a moment after its window opened is discounted in that window', async () => {
        const account = anAccount({ subscription: { startedAt: null } });
        await account.contract({
            effectiveFrom: new Date(utc('2026-01-01').getTime() + 40),
            offer: 'offer-1',
            lineItems: [STANDARD(), discountLine(9.8, { promoCode: code('ONCE', null) })],
        });

        await account.charge(utc('2026-01-02'));

        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'discount'),
            [['2026-01-01', 'discount', 'activation', -9.8]],
        );
    });

    test('an offer concluded while a charged period runs is discounted from the next one', async () => {
        const account = anAccount();
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-01'));
        // Concluded on 15 January, while January runs under the contract before it.
        await account.supersede(utc('2026-01-15'));
        await account.contract({
            effectiveFrom: utc('2026-01-15'),
            offer: 'offer-1',
            lineItems: [STANDARD(), discountLine(9.8, { promoCode: code('ONCE', null) })],
        });

        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        await account.charge(utc('2026-02-01'));

        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'discount'),
            [['2026-02-01', 'discount', 'renewal', -9.8]],
        );
    });

    test('a contract written again later, which carries no discount line, does not end it', async () => {
        const account = anAccount();
        await account.contract({
            offer: 'offer-1',
            lineItems: [STANDARD(), discountLine(9.8, { promoCode: code('MONTHS', 3) })],
        });
        await account.charge(utc('2026-01-01'));
        await account.supersede(utc('2026-01-15'));
        await account.contract({ effectiveFrom: utc('2026-01-15'), lineItems: [STANDARD()] });

        account.roll(utc('2026-02-01'), utc('2026-03-01'));
        await account.charge(utc('2026-02-01'));

        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'discount'),
            [
                ['2026-01-01', 'discount', 'activation', -9.8],
                ['2026-02-01', 'discount', 'renewal', -9.8],
            ],
        );
    });
});

// @requirement SC-PRIC-054 — Every period of a subscription is charged, at the price in force when it starts
describe('an add-on is charged even where writing its contract failed', () => {
    /** Writes the contract the way the platform's freeze does: the plan and the add-on booked. */
    function freezingInto(accountOf, { fails = false } = {}) {
        return {
            calls: [],
            async freezeOnPlanChange(tenantId, plan, cycle, at, endsAt) {
                this.calls.push({ tenantId, plan, cycle, at, endsAt });
                if (fails) throw new Error('the catalogue is down');
                const account = accountOf();
                await account.supersede(at);
                await account.contract({ effectiveFrom: at, lineItems: [STANDARD(), ARCHIVE()] });
            },
        };
    }

    test('the journal writes the contract the booking missed, and charges the add-on under it', async () => {
        let account;
        const freeze = freezingInto(() => account);
        account = anAccount({
            subscription: { canceledAt: utc('2026-01-20'), canceledEffectiveAt: utc('2026-03-01') },
            freeze,
        });
        await account.contract({ lineItems: [STANDARD()] });
        await account.charge(utc('2026-01-10'));
        // Booked on 21 January; the contract write after it failed.
        account.book();

        await account.charge(utc('2026-01-22'));

        assert.deepEqual(
            freeze.calls.map(({ tenantId, plan, cycle, at, endsAt }) => [
                tenantId,
                plan,
                cycle,
                at.toISOString(),
                endsAt?.toISOString(),
            ]),
            [
                [
                    't1',
                    'STANDARD',
                    'MONTHLY',
                    utc('2026-01-22').toISOString(),
                    utc('2026-03-01').toISOString(),
                ],
            ],
        );
        assert.deepEqual(
            account.entries().filter(([, source]) => source === 'bundle'),
            [['2026-01-21', 'bundle', 'bundleBooking', 3.55]],
        );
    });

    test('only a running add-on the contract misses makes the journal write one', async () => {
        let account;
        const freeze = freezingInto(() => account);
        account = anAccount({ freeze });
        await account.contract({ lineItems: [STANDARD(), ARCHIVE()] });
        account.book();
        account.book({
            bundleVersionId: 'bv-ended',
            canceledAt: utc('2026-01-05'),
            canceledEffectiveAt: utc('2026-01-15'),
        });
        account.book({
            bundleVersionId: 'bv-not-started',
            currentPeriodStart: null,
            currentPeriodEnd: null,
        });
        // Started as its contract took effect: written with it, not after it.
        account.book({
            bundleVersionId: 'bv-with-its-contract',
            startedAt: utc('2026-01-01'),
            currentPeriodStart: utc('2026-01-01'),
        });

        await account.charge(utc('2026-01-22'));

        assert.equal(freeze.calls.length, 0);
    });

    test('a source that does not name the booking has the contract written once, not on every call', async () => {
        let account;
        const freeze = {
            calls: 0,
            async freezeOnPlanChange(tenantId, plan, cycle, at) {
                freeze.calls += 1;
                await account.supersede(at);
                await account.contract({ effectiveFrom: at, lineItems: [STANDARD()] });
            },
        };
        account = anAccount({ freeze });
        await account.contract({ lineItems: [STANDARD()] });
        account.book();

        await account.charge(utc('2026-01-22'));
        await account.charge(utc('2026-01-23'));

        assert.equal(freeze.calls, 1);
    });

    test('nor in a trial, nor once the subscription has ended', async () => {
        for (const subscription of [
            { status: 'TRIAL' },
            { canceledAt: utc('2026-01-05'), canceledEffectiveAt: utc('2026-01-15') },
        ]) {
            let account;
            const freeze = freezingInto(() => account);
            account = anAccount({ subscription, freeze });
            await account.contract({ lineItems: [STANDARD()] });
            account.book();

            await account.charge(utc('2026-01-22'));

            assert.equal(freeze.calls.length, 0, JSON.stringify(subscription));
        }
    });

    test('a contract write that fails leaves the rest of the account charged', async () => {
        let account;
        const freeze = freezingInto(() => account, { fails: true });
        account = anAccount({ freeze });
        await account.contract({ lineItems: [STANDARD()] });
        account.book();

        const written = await account.charge(utc('2026-01-22'));

        assert.equal(freeze.calls.length, 1);
        assert.equal(written.length, 1);
        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 49]]);
    });
});

describe('the journal is configured beside frozen contracts', () => {
    const tenantBilling = (extra) => ({
        authGuards: [class Guard {}],
        subscriptionUsagePort: {},
        usageSnapshotPort: {},
        subscriptionWritePort: {},
        ...extra,
    });

    test('without a contract freeze it does not start, and says why', () => {
        assert.throws(
            () =>
                TenantBillingModule.forRoot(
                    tenantBilling({ chargeJournal: { ledgerRepository: {} } }),
                ),
            /`chargeJournal` needs `contractFreeze`/,
        );
    });

    test('with one it starts, and offers the service to the application', () => {
        const mounted = TenantBillingModule.forRoot(
            tenantBilling({
                chargeJournal: { ledgerRepository: {} },
                contractFreeze: {
                    sourcePort: {},
                    subscriptionContractRepository: {},
                    subscriberRepository: {},
                },
            }),
        );
        assert.ok(mounted.exports.includes(SubscriberChargeService));
    });
});

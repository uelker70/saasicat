// What a subscription pays while a feature it holds is withdrawn: its line
// reduced by the operator's amount for exactly the days without the feature —
// charged with the period where the period is charged then, credited from the
// date where the period was charged before, and taken back for the days the
// feature was there again — and, where it ends at once, the unused rest of
// what it was charged.
//
// Every case goes through `SubscriberChargeService.recordDueCharges` over a
// monthly subscription at 49 on `STANDARD`, which grants `EXPORT`, whose window
// a test rolls the way a renewal job does. The operator named a reduction of
// 10 a month for it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { anAccount, line, utc } from './helpers/charge-journal.js';

const plan = (priceNet = 49, overrides = {}) =>
    line('plan', 'STANDARD', priceNet, {
        sourceVersionId: 'pv-standard',
        featuresSnapshot: ['EXPORT'],
        ...overrides,
    });

/** The reduction line the announcement adds for the plan. */
const planReduction = (amountNet = 10, overrides = {}) =>
    line('discount', 'feature-withdrawal:fw-1', -amountNet, {
        metadata: {
            generated: true,
            source: 'feature-withdrawal',
            reduction: {
                withdrawalId: 'fw-1',
                line: 'plan',
                key: 'STANDARD',
                subscriptionBundleId: null,
                amountNet,
            },
        },
        ...overrides,
    });

/** The reduction line the announcement adds for one booking of an add-on. */
const bookingReduction = (subscriptionBundleId, amountNet) =>
    line('discount', `feature-withdrawal:fw-1:${subscriptionBundleId}`, -amountNet, {
        metadata: {
            generated: true,
            source: 'feature-withdrawal',
            reduction: {
                withdrawalId: 'fw-1',
                line: 'bundle',
                key: 'ARCHIVE',
                subscriptionBundleId,
                amountNet,
            },
        },
    });

const withdrawal = (fields = {}) => ({
    id: 'fw-1',
    featureKey: 'EXPORT',
    effectiveFrom: utc('2026-03-15'),
    liftedFrom: null,
    ...fields,
});

/** An account charged January to March on `STANDARD`, with an add-on where `lines` books one. */
async function chargedThroughMarch(lines = [plan()]) {
    const account = anAccount();
    await account.contract({ lineItems: lines });
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

/** The announcement on 10 March: the withdrawal told, and the successor carrying its reductions. */
async function announced(account, fields = {}, lineItems = [plan(), planReduction()]) {
    const told = account.toldOfWithdrawal(withdrawal(fields));
    await account.supersede(utc('2026-03-10'));
    await account.contract({ effectiveFrom: utc('2026-03-10'), lineItems });
    return told;
}

async function renew(account, start, end, at = utc(start)) {
    account.roll(utc(start), utc(end));
    for (const booking of account.bookings) {
        booking.currentPeriodStart = utc(start);
        booking.currentPeriodEnd = utc(end);
    }
    return account.charge(at);
}

const at = (iso) => new Date(iso);
const since = (account, day) => account.entries().filter(([start]) => start >= day);

// @requirement SC-PRIC-072 — A line that loses a withdrawn feature is charged less for the time without it
describe('a period charged before the withdrawal takes effect', () => {
    test('is credited from its date for the rest of the period, and not before the date', async () => {
        const account = await chargedThroughMarch();
        await announced(account);

        assert.deepEqual(await account.charge(at('2026-03-14T23:59:00.000Z')), [], 'not before');
        await account.charge(utc('2026-03-15'));

        // 17 of March's 31 days without the feature: 10 × 17 / 31.
        assert.deepEqual(since(account, '2026-03-02'), [
            ['2026-03-15', 'discount', 'credit', -5.48],
        ]);
    });
});

// @requirement SC-PRIC-072 — A line that loses a withdrawn feature is charged less for the time without it
describe('a period charged while the feature is withdrawn', () => {
    test('is reduced with its charge, and the next one is not once the feature is back', async () => {
        const account = await chargedThroughMarch();
        const told = await announced(account);
        await account.charge(utc('2026-03-15'));
        await renew(account, '2026-04-01', '2026-05-01');

        told.liftedFrom = utc('2026-05-01');
        await renew(account, '2026-05-01', '2026-06-01');

        assert.deepEqual(since(account, '2026-04-01'), [
            ['2026-04-01', 'discount', 'renewal', -10],
            ['2026-04-01', 'plan', 'renewal', 49],
            ['2026-05-01', 'plan', 'renewal', 49],
        ]);
    });

    test('is reduced in advance for the days from a date that falls inside it', async () => {
        const account = await chargedThroughMarch();
        await announced(account, { effectiveFrom: utc('2026-04-15') });
        await account.charge(utc('2026-03-20'));
        await renew(account, '2026-04-01', '2026-05-01');

        // 16 of April's 30 days: 10 × 16 / 30.
        assert.deepEqual(since(account, '2026-03-02'), [
            ['2026-04-01', 'discount', 'renewal', -5.33],
            ['2026-04-01', 'plan', 'renewal', 49],
        ]);
    });

    test('is reduced pro rata where the return is known when it is charged', async () => {
        const account = await chargedThroughMarch();
        const told = await announced(account);
        await account.charge(utc('2026-03-15'));
        told.liftedFrom = utc('2026-04-11');
        await renew(account, '2026-04-01', '2026-05-01');
        await account.charge(utc('2026-04-20'));

        // 10 of April's 30 days, and nothing to take back afterwards.
        assert.deepEqual(since(account, '2026-04-01'), [
            ['2026-04-01', 'discount', 'renewal', -3.33],
            ['2026-04-01', 'plan', 'renewal', 49],
        ]);
    });

    test('is never taken below nothing', async () => {
        const account = await chargedThroughMarch();
        await announced(account, {}, [plan(), planReduction(60)]);
        await account.charge(utc('2026-03-15'));
        await renew(account, '2026-04-01', '2026-05-01');

        assert.deepEqual(since(account, '2026-04-01'), [
            ['2026-04-01', 'discount', 'renewal', -49],
            ['2026-04-01', 'plan', 'renewal', 49],
        ]);
    });
});

/** A plan that grants two features, at 10 a month. */
const twoFeaturePlan = () => plan(10, { featuresSnapshot: ['EXPORT', 'IMPORT'] });

/** The reduction line of withdrawal `id` for the plan. */
const reductionOf = (id, amountNet) =>
    line('discount', `feature-withdrawal:${id}`, -amountNet, {
        metadata: {
            generated: true,
            source: 'feature-withdrawal',
            reduction: {
                withdrawalId: id,
                line: 'plan',
                key: 'STANDARD',
                subscriptionBundleId: null,
                amountNet,
            },
        },
    });

/** Both features withdrawn, each reducing the plan by its whole price, announced at `at`. */
async function twoWithdrawals(account, at, first, second) {
    const told = [
        account.toldOfWithdrawal(withdrawal({ id: 'fw-1', featureKey: 'EXPORT', ...first })),
        account.toldOfWithdrawal(withdrawal({ id: 'fw-2', featureKey: 'IMPORT', ...second })),
    ];
    await account.supersede(at);
    await account.contract({
        effectiveFrom: at,
        lineItems: [twoFeaturePlan(), reductionOf('fw-1', 10), reductionOf('fw-2', 10)],
    });
    return told;
}

// @requirement SC-PRIC-072 — A line that loses a withdrawn feature is charged less for the time without it
describe('two withdrawals of one line', () => {
    test('each take off their own days, up to what those days cost', async () => {
        const account = await chargedThroughMarch([twoFeaturePlan()]);
        await twoWithdrawals(
            account,
            utc('2026-03-10'),
            { effectiveFrom: utc('2026-04-01'), liftedFrom: utc('2026-04-16') },
            { effectiveFrom: utc('2026-04-16') },
        );
        await renew(account, '2026-04-01', '2026-05-01');

        // Fifteen of April's thirty days each, at 10 a month.
        assert.deepEqual(
            account.discounts().filter(([day]) => day >= '2026-04-01'),
            [
                ['2026-04-01', 'feature-withdrawal:fw-1', 'renewal', -5],
                ['2026-04-01', 'feature-withdrawal:fw-2', 'renewal', -5],
            ],
        );
    });

    test('take off no more than their days cost where another discount lowers the period', async () => {
        // Agreed with the contract of 10 March, so April is the first period it takes 8.00 off.
        const promo = line('discount', 'promo:SPRING', -8);
        const account = await chargedThroughMarch([twoFeaturePlan()]);
        account.toldOfWithdrawal(
            withdrawal({ effectiveFrom: utc('2026-04-16'), featureKey: 'EXPORT' }),
        );
        await account.supersede(utc('2026-03-10'));
        await account.contract({
            effectiveFrom: utc('2026-03-10'),
            lineItems: [twoFeaturePlan(), promo, reductionOf('fw-1', 10)],
        });
        await renew(account, '2026-04-01', '2026-05-01');

        // April costs 2.00 after the 8.00 off; half of it is without the feature.
        assert.deepEqual(
            account
                .discounts()
                .filter(([day, ref]) => day >= '2026-04-01' && ref === 'feature-withdrawal:fw-1'),
            [['2026-04-01', 'feature-withdrawal:fw-1', 'renewal', -1]],
        );
    });

    test('never take more together than the period costs, and the other gains what one gives back', async () => {
        const account = await chargedThroughMarch([twoFeaturePlan()]);
        await renew(account, '2026-04-01', '2026-05-01');
        const [first] = await twoWithdrawals(
            account,
            utc('2026-04-10'),
            { effectiveFrom: utc('2026-04-10') },
            { effectiveFrom: utc('2026-04-10') },
        );
        await account.charge(utc('2026-04-10'));
        first.liftedFrom = utc('2026-04-20');
        await account.charge(utc('2026-04-21'));

        // From 10 April both are missing: 21 of 30 days, 7.00 for the first and
        // what is left of the 10.00 for the second. From 20 April the first is
        // back, and its days return to the second.
        assert.deepEqual(
            account.discounts().filter(([day]) => day >= '2026-04-10'),
            [
                ['2026-04-10', 'feature-withdrawal:fw-1', 'credit', -7],
                ['2026-04-10', 'feature-withdrawal:fw-2', 'credit', -3],
                ['2026-04-20', 'feature-withdrawal:fw-1', 'reductionTakenBack', 3.67],
                ['2026-04-20', 'feature-withdrawal:fw-2', 'credit', -3.67],
            ],
        );
        assert.deepEqual(await account.charge(utc('2026-04-22')), [], 'and nothing again');
    });

    test('give the other nothing of the days one returns before they have returned', async () => {
        const account = await chargedThroughMarch([twoFeaturePlan()]);
        await renew(account, '2026-04-01', '2026-05-01');
        const [first] = await twoWithdrawals(
            account,
            utc('2026-04-10'),
            { effectiveFrom: utc('2026-04-10') },
            { effectiveFrom: utc('2026-04-10') },
        );
        await account.charge(utc('2026-04-10'));
        first.liftedFrom = utc('2026-04-20');

        // Lifted on the 15th from the 20th: until then the first still holds
        // those days, so a run between asks to write nothing — not even an
        // entry the account would turn away.
        const asked = account.ledger.offered.length;
        await account.charge(utc('2026-04-15'));
        await account.charge(utc('2026-04-19'));
        assert.deepEqual(account.ledger.offered.slice(asked), []);
        await account.charge(utc('2026-04-21'));
        assert.deepEqual(
            account.discounts().filter(([day]) => day >= '2026-04-10'),
            [
                ['2026-04-10', 'feature-withdrawal:fw-1', 'credit', -7],
                ['2026-04-10', 'feature-withdrawal:fw-2', 'credit', -3],
                ['2026-04-20', 'feature-withdrawal:fw-1', 'reductionTakenBack', 3.67],
                ['2026-04-20', 'feature-withdrawal:fw-2', 'credit', -3.67],
            ],
        );
    });

    test('never take more together than the period costs before one returns, where the other holds nothing yet', async () => {
        const account = await chargedThroughMarch([twoFeaturePlan()]);
        const [first] = await twoWithdrawals(
            account,
            utc('2026-03-10'),
            { effectiveFrom: utc('2026-04-01') },
            { effectiveFrom: utc('2026-04-10') },
        );
        // The first takes all of April's 10.00, so the second is charged nothing off.
        await renew(account, '2026-04-01', '2026-05-01');
        first.liftedFrom = utc('2026-04-20');

        assert.deepEqual(await account.charge(utc('2026-04-15')), [], 'nothing before the 20th');
        await account.charge(utc('2026-04-21'));
        // 19 days for the first, 6.33; the second gets the 3.67 that leaves.
        assert.deepEqual(
            account.discounts().filter(([day]) => day >= '2026-04-01'),
            [
                ['2026-04-01', 'feature-withdrawal:fw-1', 'renewal', -10],
                ['2026-04-10', 'feature-withdrawal:fw-2', 'credit', -3.67],
                ['2026-04-20', 'feature-withdrawal:fw-1', 'reductionTakenBack', 3.67],
            ],
        );
    });

    test('never take more together than the period costs where one begins after the other', async () => {
        const account = await chargedThroughMarch([twoFeaturePlan()]);
        await renew(account, '2026-04-01', '2026-05-01');
        await twoWithdrawals(
            account,
            utc('2026-04-01'),
            { effectiveFrom: utc('2026-04-10') },
            { effectiveFrom: utc('2026-04-01') },
        );
        await account.charge(utc('2026-04-01'));
        await account.charge(utc('2026-04-10'));

        // The second is credited at once what the first will leave it, and the
        // first its own share on its date: 10.00 together, never more.
        assert.deepEqual(
            account.discounts().filter(([day]) => day >= '2026-04-01'),
            [
                ['2026-04-01', 'feature-withdrawal:fw-2', 'credit', -3],
                ['2026-04-10', 'feature-withdrawal:fw-1', 'credit', -7],
            ],
        );
        assert.deepEqual(
            await account
                .charge(utc('2026-05-01'))
                .then((entries) =>
                    entries.filter(
                        (entry) =>
                            entry.source === 'discount' && entry.periodStart < utc('2026-05-01'),
                    ),
                ),
            [],
            'and nothing taken back at its end',
        );
    });
});

// @requirement SC-PRIC-073 — A reduction for days the feature turned out not to miss is taken back
describe('a reduction granted for days the feature turned out to be there', () => {
    test('is taken back from the day it returned, on that day', async () => {
        const account = await chargedThroughMarch();
        const told = await announced(account);
        await account.charge(utc('2026-03-15'));
        await renew(account, '2026-04-01', '2026-05-01');
        told.liftedFrom = utc('2026-04-21');

        assert.deepEqual(await account.charge(at('2026-04-20T12:00:00.000Z')), [], 'not before');
        await account.charge(utc('2026-04-21'));

        // April was reduced by 10 for 30 days; 10 of them had the feature back.
        assert.deepEqual(since(account, '2026-04-02'), [
            ['2026-04-21', 'discount', 'reductionTakenBack', 3.33],
        ]);
    });

    test('takes nothing back where the withdrawal was lifted before its date', async () => {
        const account = await chargedThroughMarch();
        const told = await announced(account, { effectiveFrom: utc('2026-04-15') });
        told.liftedFrom = utc('2026-03-25');
        await renew(account, '2026-04-01', '2026-05-01');
        await account.charge(utc('2026-04-20'));

        assert.deepEqual(since(account, '2026-03-02'), [['2026-04-01', 'plan', 'renewal', 49]]);
    });

    test('ends with a change into a longer rhythm, which credits the rest of the period', async () => {
        const account = await chargedThroughMarch();
        await announced(account);
        await account.charge(utc('2026-03-15'));
        await renew(account, '2026-04-01', '2026-05-01');

        // On 16 April the subscriber moves to the yearly rhythm.
        await account.supersede(utc('2026-04-16'));
        await account.contract({
            effectiveFrom: utc('2026-04-16'),
            lineItems: [plan(490, { billingCycle: 'yearly' })],
        });
        account.subscription.billingCycle = 'YEARLY';
        account.roll(utc('2026-04-16'), utc('2027-04-16'));
        await account.charge(utc('2026-04-16'));

        // The new period is 490 less what was left of April at 49; the
        // reduction for those 15 days goes back with it.
        assert.deepEqual(since(account, '2026-04-02'), [
            ['2026-04-16', 'discount', 'reductionTakenBack', 5],
            ['2026-04-16', 'plan', 'planChange', 465.5],
        ]);
    });
});

// @requirement SC-PRIC-072 — A line that loses a withdrawn feature is charged less for the time without it
describe('the line a reduction stays with', () => {
    test('is the plan in its rhythm on any version that grants the feature', async () => {
        const account = await chargedThroughMarch();
        await announced(account);
        await account.charge(utc('2026-03-15'));
        // A retirement moves the subscription to the next version on 1 April.
        await account.supersede(utc('2026-04-01'));
        await account.contract({
            effectiveFrom: utc('2026-04-01'),
            lineItems: [plan(52, { sourceVersionId: 'pv-next' })],
        });
        await renew(account, '2026-04-01', '2026-05-01');

        assert.deepEqual(since(account, '2026-04-01'), [
            ['2026-04-01', 'discount', 'renewal', -10],
            ['2026-04-01', 'plan', 'renewal', 52],
        ]);
    });

    test('and not a version that no longer grants it', async () => {
        const account = await chargedThroughMarch();
        await announced(account);
        await account.charge(utc('2026-03-15'));
        await account.supersede(utc('2026-04-01'));
        await account.contract({
            effectiveFrom: utc('2026-04-01'),
            lineItems: [plan(39, { sourceVersionId: 'pv-lite', featuresSnapshot: [] })],
        });
        await renew(account, '2026-04-01', '2026-05-01');

        assert.deepEqual(since(account, '2026-04-01'), [['2026-04-01', 'plan', 'renewal', 39]]);
    });

    test('and not another plan the subscriber changed to', async () => {
        const account = await chargedThroughMarch();
        await announced(account);
        await account.charge(utc('2026-03-15'));
        await account.supersede(utc('2026-04-01'));
        await account.contract({
            effectiveFrom: utc('2026-04-01'),
            lineItems: [line('plan', 'PREMIUM', 79, { featuresSnapshot: ['EXPORT'] })],
        });
        await renew(account, '2026-04-01', '2026-05-01');

        assert.deepEqual(since(account, '2026-04-01'), [['2026-04-01', 'plan', 'renewal', 79]]);
    });
});

// @requirement SC-PRIC-074 — Ending at once under a withdrawal credits the unused rest of what was charged
describe('ending at once while the feature is withdrawn', () => {
    /** An account with an add-on at 10 a month, the withdrawal in effect from 1 April. */
    async function withAnAddOn() {
        const account = anAccount();
        await account.contract({
            lineItems: [plan(), line('bundle', 'ARCHIVE', 10, { sourceVersionId: 'bv-archive' })],
        });
        account.book({
            startedAt: utc('2026-01-01'),
            currentPeriodStart: utc('2026-01-01'),
            currentPeriodEnd: utc('2026-02-01'),
        });
        await account.charge(utc('2026-01-10'));
        for (const [start, end] of [
            ['2026-02-01', '2026-03-01'],
            ['2026-03-01', '2026-04-01'],
        ]) {
            await renew(account, start, end);
        }
        account.toldOfWithdrawal(withdrawal({ effectiveFrom: utc('2026-04-01') }));
        await account.supersede(utc('2026-03-20'));
        await account.contract({
            effectiveFrom: utc('2026-03-20'),
            lineItems: [
                plan(),
                line('bundle', 'ARCHIVE', 10, { sourceVersionId: 'bv-archive' }),
                planReduction(),
            ],
        });
        await renew(account, '2026-04-01', '2026-05-01');
        return account;
    }

    for (const [name, chargedFirst, creditedBetween] of [
        ['no contract records the reduction yet, the period charged before its date', true, false],
        [
            'no contract records the reduction yet, the period charged while the feature is withdrawn',
            false,
            false,
        ],
        // The end then takes back the part of that reduction it credits as rest.
        ['a run between the date and the end has credited the whole reduction', true, true],
    ]) {
        test(`shows first what it then credits: ${name}`, async () => {
            let account;
            let written = false;
            account = anAccount({
                reductions: {
                    async linesFor() {
                        return written ? [] : [planReduction()];
                    },
                    async recordReductions(tenantId, now) {
                        if (written) return 'nothing';
                        written = true;
                        await account.supersede(now);
                        await account.contract({
                            effectiveFrom: now,
                            lineItems: [plan(), planReduction()],
                        });
                        return 'written';
                    },
                },
            });
            await account.contract({ lineItems: [plan()] });
            await account.charge(utc('2026-01-10'));
            for (const [start, end] of [
                ['2026-02-01', '2026-03-01'],
                ['2026-03-01', '2026-04-01'],
            ]) {
                await renew(account, start, end);
            }
            if (chargedFirst) await renew(account, '2026-04-01', '2026-05-01');
            account.toldOfWithdrawal(withdrawal({ effectiveFrom: utc('2026-04-01') }));
            if (!chargedFirst) {
                // Charged without the line: writing it failed, as it may.
                written = true;
                await renew(account, '2026-04-01', '2026-05-01');
                written = false;
            }
            if (creditedBetween) await account.charge(utc('2026-04-05'));

            const shown = await account.service.creditOfEndingAtOnce('t1', null, utc('2026-04-11'));
            account.endAtOnce(utc('2026-04-11'));
            const atTheEnd = (await account.charge(utc('2026-04-11'))).filter(
                (entry) => entry.periodStart.getTime() === utc('2026-04-11').getTime(),
            );

            const cents = atTheEnd.reduce(
                (sum, entry) => sum + Math.round(entry.amountNet * 100),
                0,
            );
            assert.equal(shown.creditNet, -cents / 100);
        });
    }

    // @requirement SC-BUN-064 — An add-on ending with its plan is not refunded, unless a withdrawal ends it at once
    test('credits the unused rest of the plan and of every add-on, net of the reduction', async () => {
        const account = await withAnAddOn();
        account.endAtOnce(utc('2026-04-11'));
        await account.charge(utc('2026-04-11'));

        // 20 of April's 30 days unused: 49 × 20 / 30 and 10 × 20 / 30, and the
        // reduction for those days goes back with them.
        assert.deepEqual(since(account, '2026-04-02'), [
            ['2026-04-11', 'bundle', 'credit', -6.67],
            ['2026-04-11', 'discount', 'reductionTakenBack', 6.67],
            ['2026-04-11', 'plan', 'credit', -32.67],
        ]);
        assert.deepEqual(await account.charge(utc('2026-05-01')), [], 'and nothing after');
    });

    test('credits no more than the period cost, however the rest and the reduction round', async () => {
        const account = await chargedThroughMarch([plan(10.01)]);
        await announced(account, { effectiveFrom: utc('2026-04-01') }, [
            plan(10.01),
            planReduction(10.01),
        ]);
        await renew(account, '2026-04-01', '2026-05-01');
        account.endAtOnce(utc('2026-04-16'));
        await account.charge(utc('2026-04-16'));

        // April cost nothing: 10.01, less the reduction of 10.01. Half a cent
        // either way would credit a cent nobody paid.
        const april = account.entries().filter(([day]) => day >= '2026-04-01');
        const cents = april.reduce((sum, [, , , amount]) => sum + Math.round(amount * 100), 0);
        assert.equal(cents, 0, JSON.stringify(april));
    });

    test("credits no more than a longer rhythm's period cost, whatever the period it replaced gave back", async () => {
        const account = anAccount({
            subscription: {
                startedAt: utc('2027-03-01'),
                currentPeriodStart: utc('2027-03-01'),
                currentPeriodEnd: utc('2027-04-01'),
            },
        });
        account.toldOfWithdrawal(withdrawal({ effectiveFrom: utc('2027-03-01') }));
        await account.contract({
            effectiveFrom: utc('2027-03-01'),
            lineItems: [plan(1), planReduction(1)],
        });
        await account.charge(utc('2027-03-01'));
        // Into the yearly rhythm on 16 March, reduced to nothing there too. The
        // year has 366 days, so half of it falls on half a cent.
        await account.supersede(utc('2027-03-16'));
        await account.contract({
            effectiveFrom: utc('2027-03-16'),
            lineItems: [
                plan(1.83, { billingCycle: 'yearly' }),
                planReduction(1.83, {
                    sourceKey: 'feature-withdrawal:fw-1:yearly',
                    billingCycle: 'yearly',
                }),
            ],
        });
        account.subscription.billingCycle = 'YEARLY';
        account.roll(utc('2027-03-16'), utc('2028-03-16'));
        await account.charge(utc('2027-03-16'));
        account.endAtOnce(utc('2027-09-15'));
        await account.charge(utc('2027-09-15'));

        // March gave back its reduction from the 16th, which belongs to March:
        // the year cost nothing, so its end credits nothing either.
        const atTheEnd = account.entries().filter(([day]) => day === '2027-09-15');
        const cents = atTheEnd.reduce((sum, [, , , amount]) => sum + Math.round(amount * 100), 0);
        assert.equal(cents, 0, JSON.stringify(atTheEnd));
    });

    test('credits the rest of a booking that ends at once alone, and its reduction', async () => {
        const account = anAccount();
        await account.contract({
            lineItems: [
                plan(),
                line('bundle', 'ARCHIVE', 10, {
                    sourceVersionId: 'bv-archive',
                    featuresSnapshot: ['EXPORT'],
                }),
            ],
        });
        const booking = account.book({
            startedAt: utc('2026-01-01'),
            currentPeriodStart: utc('2026-01-01'),
            currentPeriodEnd: utc('2026-02-01'),
        });
        await account.charge(utc('2026-01-10'));
        await renew(account, '2026-02-01', '2026-03-01');
        await renew(account, '2026-03-01', '2026-04-01');
        account.toldOfWithdrawal(withdrawal({ effectiveFrom: utc('2026-04-01') }));
        await account.supersede(utc('2026-03-20'));
        await account.contract({
            effectiveFrom: utc('2026-03-20'),
            lineItems: [
                plan(),
                line('bundle', 'ARCHIVE', 10, {
                    sourceVersionId: 'bv-archive',
                    featuresSnapshot: ['EXPORT'],
                }),
                bookingReduction(booking.id, 4),
            ],
        });
        await renew(account, '2026-04-01', '2026-05-01');

        account.endAtOnce(utc('2026-04-11'), booking.id);
        await account.charge(utc('2026-04-11'));

        assert.deepEqual(since(account, '2026-04-01'), [
            ['2026-04-01', 'bundle', 'renewal', 10],
            ['2026-04-01', 'discount', 'renewal', -4],
            ['2026-04-01', 'plan', 'renewal', 49],
            ['2026-04-11', 'bundle', 'credit', -6.67],
            ['2026-04-11', 'discount', 'reductionTakenBack', 2.67],
        ]);
    });

    test('shows first the credit it then writes, and writes nothing to show it', async () => {
        const account = await withAnAddOn();
        const before = account.entries().length;
        const shown = await account.service.creditOfEndingAtOnce('t1', null, utc('2026-04-11'));
        assert.equal(account.entries().length, before, 'the preview writes nothing');

        account.endAtOnce(utc('2026-04-11'));
        const written = await account.charge(utc('2026-04-11'));

        assert.deepEqual(shown, { creditNet: 32.67, currency: 'EUR' });
        const cents = written.reduce((sum, entry) => sum + Math.round(entry.amountNet * 100), 0);
        assert.equal(-cents / 100, shown.creditNet);
    });

    // @requirement SC-BUN-064 — An add-on ending with its plan is not refunded, unless a withdrawal ends it at once
    test('credits nothing for an end the account was not told was at once', async () => {
        const account = await withAnAddOn();
        // The same moment, but recorded as an ordinary end.
        account.subscription.canceledAt = utc('2026-04-11');
        account.subscription.canceledEffectiveAt = utc('2026-04-11');
        await account.charge(utc('2026-04-11'));

        assert.deepEqual(since(account, '2026-04-02'), []);
    });

    test('credits nothing where the end recorded is not the one the notice names', async () => {
        const account = await withAnAddOn();
        account.endAtOnce(utc('2026-04-11'));
        account.subscription.canceledEffectiveAt = utc('2026-04-12');
        await account.charge(utc('2026-04-12'));

        assert.deepEqual(
            since(account, '2026-04-02').filter(([, , origin]) => origin === 'credit'),
            [],
        );
    });

    test('writes each entry once however often the account is brought up to date', async () => {
        const account = await withAnAddOn();
        account.endAtOnce(utc('2026-04-11'));
        await account.charge(utc('2026-04-11'));
        const after = account.entries().length;
        assert.deepEqual(await account.charge(utc('2026-04-12')), []);
        assert.equal(account.entries().length, after);
    });
});

// @requirement SC-PRIC-072 — A line that loses a withdrawn feature is charged less for the time without it
describe('a reduction no contract records yet', () => {
    test('is written into the contract before the period is charged', async () => {
        const calls = [];
        let account;
        account = anAccount({
            reductions: {
                async recordReductions(tenantId, now) {
                    calls.push(tenantId);
                    if (calls.length > 1) return 'nothing';
                    await account.supersede(now);
                    await account.contract({
                        effectiveFrom: now,
                        lineItems: [plan(), planReduction()],
                    });
                    return 'written';
                },
            },
        });
        await account.contract({ lineItems: [plan()] });
        await account.charge(utc('2026-01-10'));
        account.toldOfWithdrawal(withdrawal({ effectiveFrom: utc('2026-02-01') }));
        await renew(account, '2026-02-01', '2026-03-01');

        assert.deepEqual(since(account, '2026-02-01'), [
            ['2026-02-01', 'discount', 'renewal', -10],
            ['2026-02-01', 'plan', 'renewal', 49],
        ]);
        assert.deepEqual(calls, ['t1']);
    });

    test('is asked for only where the subscription was told of a withdrawal', async () => {
        const calls = [];
        const account = anAccount({
            reductions: { recordReductions: async (tenantId) => calls.push(tenantId) },
        });
        await account.contract({ lineItems: [plan()] });
        await account.charge(utc('2026-01-10'));
        assert.deepEqual(calls, []);
    });

    test('leaves the rest charged where writing it fails', async () => {
        const account = anAccount({
            reductions: {
                recordReductions: async () => {
                    throw new Error('database gone');
                },
            },
        });
        await account.contract({ lineItems: [plan()] });
        account.toldOfWithdrawal(withdrawal({ effectiveFrom: utc('2026-02-01') }));
        await account.charge(utc('2026-01-10'));
        assert.deepEqual(account.entries(), [['2026-01-01', 'plan', 'activation', 49]]);
    });
});

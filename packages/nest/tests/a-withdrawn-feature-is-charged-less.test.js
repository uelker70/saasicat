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

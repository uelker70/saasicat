// What a promo code takes off stays within the price it is applied to — when
// the code is created, when it is changed, when it is previewed and when it is
// redeemed, and at the same cent in each.
//
// A change is held to the checks a new code gets, or a code created at 10
// against an 11.78 plan could be changed to 35, or a percentage to 150. And a
// redemption asks the preview's question about an invoice of zero and records
// no more than the price, because whoever applies it per period computes the
// price from what it recorded.
//
// The plans are BASIC at 11.78 and STANDARD at 29.63 gross a month.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BASIC_GROSS,
    MemoryPromoCodes,
    MemorySubscriptions,
    PROMO_CATALOG,
    inDays,
    promoCodesOver,
    refusedWith,
} from './helpers/promo-slots.js';

/** A cent either side of BASIC's price, written out: 11.78 - 0.01 is not 11.77 in floating point. */
const JUST_BELOW = 11.77;
const JUST_ABOVE = 11.79;

/** A code as it stands in the store, and the promo service over it. */
function withCode(terms, { catalog } = {}) {
    const codes = new MemoryPromoCodes();
    const promo = codes.add({ code: 'MONEY-OFF', ...terms });
    const subscriptions = new MemorySubscriptions();
    subscriptions.add({ id: 'subscription-1', tenantId: 'tenant-1', plan: 'BASIC' });
    const built = promoCodesOver({ codes, subscriptions, ...(catalog ? { catalog } : {}) });
    return { ...built, promo };
}

function redeemOnBasic({ service }) {
    return service.redeem({
        code: 'MONEY-OFF',
        subscriptionId: 'subscription-1',
        tenantId: 'tenant-1',
    });
}

const absolute = (value, allowZeroInvoice = false) => ({
    valueType: 'ABSOLUTE',
    value: value.toFixed(2),
    allowZeroInvoice,
});

// @requirement SC-PROMO-005 — A percentage discount is between 0 and 100
describe('a changed percentage stays between 0 and 100', () => {
    for (const value of [0, 100.01, 150]) {
        test(`${value} % is refused`, async () => {
            const { service, promo, codes } = withCode({ value: '10.00' });

            await assert.rejects(
                service.update(promo.id, { value }),
                refusedWith('PROMO_PERCENT_OUT_OF_RANGE'),
            );
            assert.equal((await codes.findById(promo.id)).value, '10.00', 'nothing changed');
        });
    }

    test('100 % and 0.01 % are accepted', async () => {
        const { service, promo } = withCode({ value: '10.00' });

        assert.equal((await service.update(promo.id, { value: 100 })).value, '100');
        assert.equal((await service.update(promo.id, { value: 0.01 })).value, '0.01');
    });

    test('an amount of 150 turned into a percentage without a new value is refused', async () => {
        const { service, promo } = withCode(absolute(150, true));

        await assert.rejects(
            service.update(promo.id, { valueType: 'PERCENT' }),
            refusedWith('PROMO_PERCENT_OUT_OF_RANGE'),
        );
    });
});

// @requirement SC-PROMO-008 — An absolute discount stays below the lowest price it can apply to
describe('a changed amount stays below the lowest price it can apply to', () => {
    test('an amount of nothing, or less, is refused', async () => {
        const { service, promo } = withCode(absolute(5));

        for (const value of [0, -5]) {
            await assert.rejects(
                service.update(promo.id, { value }),
                refusedWith('PROMO_AMOUNT_NOT_POSITIVE'),
            );
        }
    });

    test('the lowest price itself is refused, and a cent below it accepted', async () => {
        const { service, promo } = withCode(absolute(5));

        await assert.rejects(
            service.update(promo.id, { value: BASIC_GROSS }),
            refusedWith('PROMO_WOULD_PRODUCE_ZERO_INVOICE'),
        );
        const below = await service.update(promo.id, { value: JUST_BELOW });
        assert.equal(Number(below.value), 11.77);
    });

    test('more than the price is accepted where the operator allows an invoice of zero', async () => {
        const { service, promo } = withCode(absolute(5, true));

        assert.equal((await service.update(promo.id, { value: 35 })).value, '35');
    });

    test('taking back the allowance of an invoice of zero is refused while the amount needs it', async () => {
        const { service, promo } = withCode(absolute(35, true));

        await assert.rejects(
            service.update(promo.id, { allowZeroInvoice: false }),
            refusedWith('PROMO_WOULD_PRODUCE_ZERO_INVOICE'),
        );
    });

    test('limiting it to a plan it would make free is refused', async () => {
        const { service, promo } = withCode({ ...absolute(20), appliesToPlans: ['STANDARD'] });

        await assert.rejects(
            service.update(promo.id, { appliesToPlans: ['BASIC'] }),
            refusedWith('PROMO_WOULD_PRODUCE_ZERO_INVOICE'),
        );
    });
});

describe('a change is held to the rules its fields bear on', () => {
    test('pausing a code whose terms no longer fit still works', async () => {
        // Pausing is how an operator stops a code; a code a former release let
        // through at 150 % has to be stoppable too.
        const { service, promo } = withCode({ value: '150.00' });

        assert.equal((await service.update(promo.id, { status: 'PAUSED' })).status, 'PAUSED');
    });

    test('a one-off discount given a duration, or left with its old one, is refused', async () => {
        const { service, promo } = withCode({ durationType: 'MONTHS', durationValue: 3 });

        await assert.rejects(
            service.update(promo.id, { durationType: 'ONCE' }),
            refusedWith('PROMO_ONE_OFF_WITH_DURATION'),
        );
        const once = await service.update(promo.id, { durationType: 'ONCE', durationValue: null });
        assert.equal(once.durationType, 'ONCE');
    });

    test('a validity that ends before it begins is refused', async () => {
        const { service, promo } = withCode({ validFrom: inDays(10) });

        await assert.rejects(
            service.update(promo.id, { validUntil: inDays(5) }),
            refusedWith('PROMO_VALIDITY_WINDOW_INVALID'),
        );
    });
});

// @requirement SC-PROMO-008 — An absolute discount stays below the lowest price it can apply to
describe('redeeming takes off no more than the price', () => {
    const cases = [
        { what: 'a cent below the price', value: JUST_BELOW, allow: false, applied: '11.77' },
        { what: 'the price', value: BASIC_GROSS, allow: false, applied: null },
        { what: 'the price', value: BASIC_GROSS, allow: true, applied: '11.78' },
        { what: 'a cent above the price', value: JUST_ABOVE, allow: false, applied: null },
        { what: 'a cent above the price', value: JUST_ABOVE, allow: true, applied: '11.78' },
    ];
    for (const { what, value, allow, applied } of cases) {
        const allowance = allow ? 'where an invoice of zero is allowed' : 'where it is not';
        const outcome = applied === null ? 'refused' : `recorded as ${applied}`;
        test(`${what}, ${allowance}: ${outcome}`, async () => {
            const ctx = withCode(absolute(value, allow));

            if (applied === null) {
                await assert.rejects(
                    redeemOnBasic(ctx),
                    refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'WOULD_PRODUCE_ZERO_INVOICE'),
                );
                assert.equal(ctx.redemptions.rows.length, 0);
                assert.equal((await ctx.codes.findById(ctx.promo.id)).redemptionsCount, 0);
                return;
            }
            const redemption = await redeemOnBasic(ctx);
            assert.equal(redemption.appliedValue, applied);
        });
    }

    test('a percentage of 100 is refused where an invoice of zero is not allowed', async () => {
        await assert.rejects(
            redeemOnBasic(withCode({ value: '100.00' })),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'WOULD_PRODUCE_ZERO_INVOICE'),
        );
        const allowed = await redeemOnBasic(withCode({ value: '100.00', allowZeroInvoice: true }));
        assert.equal(allowed.appliedValue, '100.00');
    });

    test('a percentage stored above 100 is recorded at 100', async () => {
        const redemption = await redeemOnBasic(
            withCode({ value: '150.00', allowZeroInvoice: true }),
        );

        assert.equal(redemption.appliedValue, '100.00');
    });

    test('a plan made cheaper than the code after it was created refuses the redemption', async () => {
        const cheaper = {
            ...PROMO_CATALOG,
            plans: [{ ...PROMO_CATALOG.plans[0], monthlyNet: 8 }],
        };

        await assert.rejects(
            redeemOnBasic(withCode(absolute(10), { catalog: cheaper })),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'WOULD_PRODUCE_ZERO_INVOICE'),
        );
    });
});

describe('the preview draws the line at the same cent', () => {
    function previewOnBasic(ctx) {
        return ctx.service.preview({ code: 'MONEY-OFF', planId: 'BASIC', billingCycle: 'MONTHLY' });
    }

    test('a cent below the price leaves a cent to pay', async () => {
        const preview = await previewOnBasic(withCode(absolute(JUST_BELOW)));

        assert.equal(preview.valid, true);
        assert.equal(preview.price.discountedGross, '0.01');
    });

    test('the price itself is refused unless an invoice of zero is allowed', async () => {
        assert.deepEqual(await previewOnBasic(withCode(absolute(BASIC_GROSS))), {
            valid: false,
            reason: 'WOULD_PRODUCE_ZERO_INVOICE',
        });
        const allowed = await previewOnBasic(withCode(absolute(BASIC_GROSS, true)));
        assert.equal(allowed.price.discountedGross, '0.00');
    });

    test('more than the price takes off the price and no more', async () => {
        const preview = await previewOnBasic(withCode(absolute(JUST_ABOVE, true)));

        assert.equal(preview.price.discountGross, '11.78');
        assert.equal(preview.price.discountedGross, '0.00');
    });

    test('holding the code for a checkout refuses where the preview does', async () => {
        const ctx = withCode(absolute(BASIC_GROSS));

        await assert.rejects(
            ctx.service.holdForCheckout({
                checkoutOfferId: 'offer-1',
                code: 'MONEY-OFF',
                planId: 'BASIC',
                billingCycle: 'MONTHLY',
                until: inDays(30),
            }),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'WOULD_PRODUCE_ZERO_INVOICE'),
        );
    });
});

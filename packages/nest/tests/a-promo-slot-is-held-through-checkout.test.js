// A customer who reaches the payment form keeps the promo code they started the
// checkout with.
//
// Without a hold, the code's last redemption can go to somebody else between
// the start of the checkout and the payment confirmation; the conclusion then
// refuses, and the customer has entered a payment method for nothing. A hold
// takes the slot when the checkout starts, and the conclusion redeems the code
// on it.
//
// The checkout offer service and the promo service are the real ones, over the
// in-memory stores of `helpers/promo-slots.js`, whose counting the persistence
// contract holds both adapters to against PostgreSQL.

// @requirement SC-PROMO-023 — A customer at the payment form keeps the promo code the checkout started with

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { PromoCodeExpirer } from '../dist/promo/index.js';

import {
    OFFER_PLANS,
    concludeFor,
    installation,
    redeemDirectly,
} from './helpers/held-code-installation.js';
import { MemoryRedemptions, inDays, promoCodesOver, refusedWith } from './helpers/promo-slots.js';

const THIRTY_DAYS = () => inDays(30);

describe('the last slot of a code, held for a checkout', () => {
    test('is refused to a second checkout and to a redemption, and the paid checkout redeems it', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        const ben = await ctx.offerWithCode();

        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });
        assert.deepEqual(await ctx.counts(), { held: 1, redeemed: 0, status: 'ACTIVE' });

        await assert.rejects(
            ctx.service.holdPromoCode(ben.id, { until: THIRTY_DAYS() }),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'EXHAUSTED'),
        );
        await assert.rejects(
            redeemDirectly(ctx, 'tenant-cleo'),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'EXHAUSTED'),
        );
        await assert.rejects(
            ctx.offerWithCode(),
            refusedWith('CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED', 'EXHAUSTED'),
            'a new offer is not even priced with it',
        );

        await concludeFor(ctx, anna.id, 'tenant-anna');

        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 1, status: 'EXHAUSTED' });
        assert.deepEqual(
            ctx.redemptions.rows.map((row) => row.tenantId),
            ['tenant-anna'],
        );
    });

    test('without a hold, it can go to somebody else between checkout and payment', async () => {
        // What the hold is for: the same story with no checkout holding the slot
        // ends with the paying customer refused.
        const ctx = installation();
        const anna = await ctx.offerWithCode();

        await redeemDirectly(ctx, 'tenant-cleo');

        await assert.rejects(
            concludeFor(ctx, anna.id, 'tenant-anna'),
            refusedWith('CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED', 'EXHAUSTED'),
        );
    });

    test('is redeemed for its checkout even when the code was paused since', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        const ben = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        await ctx.promoCodes.update(ctx.promo.id, { status: 'PAUSED' });

        await assert.rejects(
            ctx.service.holdPromoCode(ben.id, { until: THIRTY_DAYS() }),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'PAUSED'),
            'a paused code starts no new checkout',
        );
        await concludeFor(ctx, anna.id, 'tenant-anna');
        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 1, status: 'PAUSED' });
    });

    test('is redeemed for its checkout even when the code ran past its validity since', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        ctx.codes.codes.get(ctx.promo.id).validUntil = inDays(-1);

        await concludeFor(ctx, anna.id, 'tenant-anna');
        const row = await ctx.codes.findById(ctx.promo.id);
        assert.equal(row.status, 'EXPIRED', 'the code did expire meanwhile');
        assert.equal(row.redemptionsCount, 1);
    });
});

describe('a checkout keeps one slot, for as long as it runs', () => {
    test('starting it again moves the expiry of its slot and takes no second one', async () => {
        const ctx = installation({ code: { maxRedemptions: 2 } });
        const anna = await ctx.offerWithCode();
        const later = inDays(40);

        await ctx.service.holdPromoCode(anna.id, { until: inDays(1) });
        await ctx.service.holdPromoCode(anna.id, { until: later });

        assert.deepEqual(await ctx.counts(), { held: 1, redeemed: 0, status: 'ACTIVE' });
        const hold = await ctx.codes.holdRepository.findByCheckoutOffer(anna.id);
        assert.equal(hold.expiresAt.getTime(), later.getTime());
    });

    test('starting it again for less keeps the later expiry: a form opened before can still be paid on', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        const firstForm = inDays(4);
        await ctx.service.holdPromoCode(anna.id, { until: firstForm });

        await ctx.service.holdPromoCode(anna.id, { until: new Date(Date.now() + 10 * 60_000) });

        const hold = await ctx.codes.holdRepository.findByCheckoutOffer(anna.id);
        assert.equal(hold.expiresAt.getTime(), firstForm.getTime());
    });

    test('starting it again on the last slot, which it holds itself, is not refused', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();

        await ctx.service.holdPromoCode(anna.id, { until: inDays(1) });
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        assert.deepEqual(await ctx.counts(), { held: 1, redeemed: 0, status: 'ACTIVE' });
    });

    test('changing its offer keeps the slot while the code stays on it', async () => {
        // Going back from the payment form to change the rhythm does not cost
        // the customer the code they held the last slot of.
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        const yearly = await ctx.service.update(anna.id, { billingCycle: 'yearly' });

        assert.equal(yearly.promoCode, 'LAST-SLOT');
        assert.deepEqual(await ctx.counts(), { held: 1, redeemed: 0, status: 'ACTIVE' });
    });

    test('removing the code from its offer gives the slot back', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        await ctx.service.update(anna.id, { promoCode: null });

        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 0, status: 'ACTIVE' });
    });

    test('holding another code for it gives the slot of the first one back', async () => {
        const ctx = installation();
        const other = ctx.codes.add({ code: 'OTHER-CODE', maxRedemptions: 1 });
        const hold = (code) =>
            ctx.promoCodes.holdForCheckout({
                checkoutOfferId: 'offer-anna',
                code,
                planId: 'STANDARD',
                billingCycle: 'MONTHLY',
                until: THIRTY_DAYS(),
            });
        await hold('LAST-SLOT');

        await hold('OTHER-CODE');

        const held = await ctx.codes.holdRepository.findByCheckoutOffer('offer-anna');
        assert.equal(held.promoCodeId, other.id);
        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 0, status: 'ACTIVE' });
        assert.equal((await ctx.codes.findById(other.id)).heldCount, 1);
    });

    test('a code changed on the offer while its slot is being taken moves the slot to the new code', async () => {
        // The update gives back the slot of the code it replaces before that
        // slot exists; the hold then reads the offer again and follows it.
        const ctx = installation();
        const other = ctx.codes.add({ code: 'OTHER-CODE', maxRedemptions: 1 });
        const anna = await ctx.offerWithCode();
        const take = ctx.promoCodes.holdForCheckout.bind(ctx.promoCodes);
        let crossed = false;
        ctx.promoCodes.holdForCheckout = async (input) => {
            if (!crossed) {
                crossed = true;
                await ctx.service.update(anna.id, { promoCode: 'OTHER-CODE' });
            }
            return take(input);
        };

        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 0, status: 'ACTIVE' });
        assert.equal((await ctx.codes.findById(other.id)).heldCount, 1);
    });

    test('an offer whose code keeps changing under the hold is refused as changed, and holds nothing', async () => {
        const ctx = installation();
        ctx.codes.add({ code: 'OTHER-CODE', maxRedemptions: 1 });
        const anna = await ctx.offerWithCode();
        const take = ctx.promoCodes.holdForCheckout.bind(ctx.promoCodes);
        ctx.promoCodes.holdForCheckout = async (input) => {
            const next = input.code === 'LAST-SLOT' ? 'OTHER-CODE' : 'LAST-SLOT';
            await ctx.service.update(anna.id, { promoCode: next });
            return take(input);
        };

        await assert.rejects(
            ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() }),
            (error) => error.getResponse().code === 'CHECKOUT_OFFER_CHANGED',
        );
        assert.equal(await ctx.codes.holdRepository.findByCheckoutOffer(anna.id), null);
    });

    test('opening its form again after the code was paused moves its live slot rather than refusing it', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: inDays(1) });
        await ctx.promoCodes.update(ctx.promo.id, { status: 'PAUSED' });
        const later = inDays(2);

        await ctx.service.holdPromoCode(anna.id, { until: later });

        const hold = await ctx.codes.holdRepository.findByCheckoutOffer(anna.id);
        assert.equal(hold.expiresAt.getTime(), later.getTime());
        assert.deepEqual(await ctx.counts(), { held: 1, redeemed: 0, status: 'PAUSED' });
    });

    test('a slot that expired is no longer its own: a paused code refuses it a new one', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: inDays(-1) });
        await ctx.promoCodes.update(ctx.promo.id, { status: 'PAUSED' });

        await assert.rejects(
            ctx.service.holdPromoCode(anna.id, { until: inDays(1) }),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'PAUSED'),
        );
    });

    test('an offer without a code holds nothing', async () => {
        const ctx = installation();
        const plain = await ctx.service.create({ planKey: 'STANDARD', billingCycle: 'monthly' });

        await ctx.service.holdPromoCode(plain.id, { until: THIRTY_DAYS() });

        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 0, status: 'ACTIVE' });
    });

    test('a slot whose checkout expired is free again for somebody else', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        const ben = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: inDays(-1) });

        await ctx.service.holdPromoCode(ben.id, { until: THIRTY_DAYS() });

        assert.deepEqual(await ctx.counts(), { held: 1, redeemed: 0, status: 'ACTIVE' });
        assert.equal(await ctx.codes.holdRepository.findByCheckoutOffer(anna.id), null);
    });

    test('a redemption outside any checkout takes the slot of a checkout that expired', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: inDays(-1) });

        await redeemDirectly(ctx, 'tenant-cleo');

        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 1, status: 'EXHAUSTED' });
    });

    test('a checkout concluded after its slot expired redeems a free one, if one is left', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: inDays(-1) });

        await concludeFor(ctx, anna.id, 'tenant-anna');

        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 1, status: 'EXHAUSTED' });
    });

    test('and is refused when the slot went to somebody else after it expired', async () => {
        // The one refusal a hold leaves: a confirmation arriving after the
        // checkout itself expired, which a sign-up refuses anyway once its
        // expired checkout is cleaned up.
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: inDays(-1) });
        await redeemDirectly(ctx, 'tenant-cleo');

        await assert.rejects(
            concludeFor(ctx, anna.id, 'tenant-anna'),
            refusedWith('CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED', 'EXHAUSTED'),
        );
    });
});

describe('the conclusion and the held slot', () => {
    test('a conclusion that does not redeem the code gives its slot back', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        await concludeFor(ctx, anna.id, 'tenant-anna', { redeem: false });

        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 0, status: 'ACTIVE' });
    });

    test('a conclusion that fails keeps the slot for the retry, which redeems it', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        await assert.rejects(
            concludeFor(ctx, anna.id, 'tenant-anna', { thenFail: true }),
            /could not start its subscription/,
        );
        assert.deepEqual(await ctx.counts(), { held: 1, redeemed: 0, status: 'ACTIVE' });
        assert.equal(ctx.redemptions.rows.length, 0);

        await concludeFor(ctx, anna.id, 'tenant-anna');
        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 1, status: 'EXHAUSTED' });
    });

    test('a slot held for one offer is not taken by the redemption of another', async () => {
        const ctx = installation({ code: { maxRedemptions: 2 } });
        const anna = await ctx.offerWithCode();
        const ben = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        await concludeFor(ctx, ben.id, 'tenant-ben');

        assert.deepEqual(await ctx.counts(), { held: 1, redeemed: 1, status: 'ACTIVE' });
        await assert.rejects(
            redeemDirectly(ctx, 'tenant-cleo'),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'EXHAUSTED'),
            "anna's slot is still hers",
        );
        await concludeFor(ctx, anna.id, 'tenant-anna');
        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 2, status: 'EXHAUSTED' });
    });
});

describe('a code a checkout cannot hold', () => {
    test('refuses the start with the reason, and holds nothing', async () => {
        const ctx = installation({ code: { firstTimeCustomersOnly: true, maxRedemptions: 5 } });
        const anna = await ctx.offerWithCode();
        ctx.promoCodes = promoCodesOver({
            codes: ctx.codes,
            catalog: OFFER_PLANS,
            existingCustomers: ['anna@meier.example'],
        }).service;

        await assert.rejects(
            ctx.promoCodes.holdForCheckout({
                checkoutOfferId: anna.id,
                code: 'LAST-SLOT',
                planId: 'STANDARD',
                billingCycle: 'MONTHLY',
                email: 'anna@meier.example',
                until: THIRTY_DAYS(),
            }),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'NOT_FIRST_TIME_CUSTOMER'),
        );
        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 0, status: 'ACTIVE' });
    });

    test('a code paused while its slot is being taken is refused as paused, not as run out', async () => {
        const ctx = installation({ code: { maxRedemptions: 5 } });
        const anna = await ctx.offerWithCode();
        const holds = ctx.codes.holdRepository;
        const take = holds.take.bind(holds);
        holds.take = async (input) => {
            await ctx.promoCodes.update(ctx.promo.id, { status: 'PAUSED' });
            return take(input);
        };

        await assert.rejects(
            ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() }),
            refusedWith('PROMO_CODE_NOT_REDEEMABLE', 'PAUSED'),
        );
        assert.equal(await holds.findByCheckoutOffer(anna.id), null);
    });

    test('an offer no longer open holds nothing', async () => {
        const ctx = installation({ code: { maxRedemptions: 5 } });
        const anna = await ctx.offerWithCode();
        await concludeFor(ctx, anna.id, 'tenant-anna');

        await assert.rejects(
            ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() }),
            refusedWith('CHECKOUT_OFFER_ALREADY_CONSUMED'),
        );
        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 1, status: 'ACTIVE' });
    });

    test('an installation whose persistence keeps no holds says what is missing', async () => {
        const ctx = installation({ holds: false });
        const anna = await ctx.offerWithCode();

        await assert.rejects(
            ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() }),
            /needs a PromoCodeHoldRepository/,
        );
    });
});

describe('the operator and a held slot', () => {
    test('a code a checkout holds a slot of is not deleted, and says so', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });

        await assert.rejects(ctx.promoCodes.softDelete(ctx.promo.id), (error) => {
            const body = error.getResponse();
            assert.equal(body.code, 'PROMO_CODE_HAS_REDEMPTIONS');
            assert.deepEqual(body.params, { promoCodeId: ctx.promo.id, redemptions: 0, held: 1 });
            return true;
        });
        const stats = await ctx.promoCodes.stats(ctx.promo.id);
        assert.equal(stats.held, 1);
        assert.equal(stats.code.heldCount, 1);
    });

    test('once the checkout expired, the code can be deleted', async () => {
        const ctx = installation();
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: inDays(-1) });

        await ctx.promoCodes.softDelete(ctx.promo.id);

        assert.ok((await ctx.codes.findById(ctx.promo.id)).deletedAt instanceof Date);
    });

    test('the list shows what is held right now, expired checkouts given back', async () => {
        const ctx = installation({ code: { maxRedemptions: 3 } });
        const anna = await ctx.offerWithCode();
        const ben = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: THIRTY_DAYS() });
        await ctx.service.holdPromoCode(ben.id, { until: inDays(-1) });

        const [listed] = await ctx.promoCodes.findAll();

        assert.equal(listed.heldCount, 1);
    });

    test('the nightly sweep gives back the slots of checkouts that expired', async () => {
        const ctx = installation({ code: { maxRedemptions: 3 } });
        const anna = await ctx.offerWithCode();
        await ctx.service.holdPromoCode(anna.id, { until: inDays(-1) });

        await new PromoCodeExpirer(
            ctx.codes,
            new MemoryRedemptions(),
            ctx.codes.holdRepository,
        ).expirePromoCodes();

        assert.deepEqual(await ctx.counts(), { held: 0, redeemed: 0, status: 'ACTIVE' });
    });
});

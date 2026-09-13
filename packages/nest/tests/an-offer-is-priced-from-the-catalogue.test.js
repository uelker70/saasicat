// @requirement SC-MKT-023 — An offer's amounts are computed from the catalogue, never taken from the request

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
    CheckoutOfferModule,
    CreateCheckoutOfferDto,
    UpdateCheckoutOfferDto,
} from '../dist/checkout-offer/index.js';

import {
    BUNDLE_VERSION,
    PLAN_VERSION,
    START10,
    buildOfferService,
    fakeBundleRepo,
    fakePlanRepo,
    fakePromoCodes,
    fakePromotionRepo,
} from './helpers/checkout-catalogue.js';

// What a hand-built request would add to a selection to buy for less.
const PRICED_BY_THE_CALLER = {
    planVersionId: 'pv-cheap',
    priceBreakdown: {
        currency: 'EUR',
        billingCycle: 'monthly',
        planNet: 0,
        bundlesNet: 0,
        regularNet: 0,
        effectiveNet: 0,
        vatRate: 19,
        effectiveGross: 0,
    },
    lineItems: [{ kind: 'plan', sourceKey: 'STANDARD', priceNet: 0, priceGross: 0, quantity: 1 }],
    promotionSnapshots: [{ id: 'free', resolvedAmountNet: 49 }],
    promoCodeSnapshot: { code: 'FREE', resolvedAmountNet: 49 },
};

const select = (extra = {}) => ({ planKey: 'STANDARD', billingCycle: 'monthly', ...extra });

const ON_SALE_SINCE = '2026-01-01';
const ON_SALE_UNTIL = '2099-12-31';

function promotion(fields) {
    return {
        id: 'promo',
        internalLabel: 'internal',
        type: 'percent',
        value: 20,
        appliesTo: ['STANDARD'],
        targetType: 'PLAN',
        billingCycle: 'both',
        validFrom: ON_SALE_SINCE,
        validTo: ON_SALE_UNTIL,
        priority: 1,
        onlyLocales: null,
        requiresCoupon: false,
        codes: [],
        color: '#000',
        i18n: { de: { badge: '20 % Rabatt' } },
        ...fields,
    };
}

function refusedWith(code, params = {}) {
    return (error) => {
        assert.equal(error.status, 422, error.message);
        assert.equal(error.response?.code, code);
        for (const [key, value] of Object.entries(params)) {
            assert.equal(error.response?.params?.[key], value, key);
        }
        return true;
    };
}

describe('what a request says is not an amount', () => {
    test('the public bodies strip amounts before the service sees them', async () => {
        for (const Dto of [CreateCheckoutOfferDto, UpdateCheckoutOfferDto]) {
            const body = plainToInstance(Dto, { ...select(), ...PRICED_BY_THE_CALLER });
            const errors = await validate(body, { whitelist: true });
            assert.deepEqual(errors, [], Dto.name);
            for (const field of Object.keys(PRICED_BY_THE_CALLER)) {
                assert.equal(field in body, false, `${Dto.name} kept ${field}`);
            }
        }
    });

    test('a service called without that pipe still prices from the catalogue', async () => {
        const { service } = buildOfferService();
        const offer = await service.create({ ...select(), ...PRICED_BY_THE_CALLER });
        assert.equal(offer.planVersionId, PLAN_VERSION.id);
        assert.equal(offer.priceBreakdown.effectiveNet, 49);
        assert.deepEqual(offer.promotionSnapshots, []);
        assert.equal(offer.promoCodeSnapshot, null);
        assert.deepEqual(
            offer.lineItems.map((item) => [item.kind, item.priceNet, item.priceGross]),
            [['plan', 49, 58.31]],
        );
    });

    test('an update cannot bring amounts in either', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select());
        const updated = await service.update(offer.id, PRICED_BY_THE_CALLER);
        assert.equal(updated.priceBreakdown.effectiveNet, 49);
        assert.equal(updated.lineItems.length, 1);
    });
});

describe('where each amount comes from', () => {
    test('the plan version on sale, in the rhythm chosen, with the installation VAT in per cent', async () => {
        const { service } = buildOfferService();
        const monthly = await service.create(select());
        const yearly = await service.create(select({ billingCycle: 'yearly' }));
        assert.deepEqual(monthly.priceBreakdown, {
            currency: 'EUR',
            billingCycle: 'monthly',
            planNet: 49,
            bundlesNet: 0,
            regularNet: 49,
            effectiveNet: 49,
            vatRate: 19,
            effectiveGross: 58.31,
        });
        assert.equal(yearly.priceBreakdown.planNet, 490);
        assert.equal(yearly.priceBreakdown.effectiveGross, 583.1);
    });

    test("an add-on's price for that plan and rhythm, its override included", async () => {
        const withOverride = {
            ...BUNDLE_VERSION,
            pricingOverrides: [{ planId: 'STANDARD', monthlyNet: '9.00', yearlyNet: '90.00' }],
        };
        const { service } = buildOfferService({ bundles: fakeBundleRepo([withOverride]) });
        const monthly = await service.create(select({ bundleVersionIds: [withOverride.id] }));
        const yearly = await service.create(
            select({ billingCycle: 'yearly', bundleVersionIds: [withOverride.id] }),
        );
        assert.equal(monthly.priceBreakdown.bundlesNet, 9);
        assert.equal(yearly.priceBreakdown.bundlesNet, 90);
        assert.equal(yearly.lineItems[1].priceGross, 107.1);
    });

    test('the promotion the public catalogue picks, as a discount with its snapshot', async () => {
        const { service } = buildOfferService({
            promotions: fakePromotionRepo([promotion({ id: 'spring' })]),
        });
        const offer = await service.create(select());
        assert.equal(offer.promotionId, 'spring');
        assert.equal(offer.promotionSnapshots[0].resolvedAmountNet, 9.8);
        assert.equal(offer.promotionSnapshots[0].label, '20 % Rabatt');
        assert.equal(offer.priceBreakdown.effectiveNet, 39.2);
        assert.equal(offer.lineItems.find((item) => item.kind === 'discount').priceNet, -9.8);
    });

    test('a promotion tied to a code, or to another language, is not applied', async () => {
        const { service } = buildOfferService({
            promotions: fakePromotionRepo([
                promotion({ id: 'coupon', requiresCoupon: true }),
                promotion({ id: 'english', onlyLocales: ['en'] }),
            ]),
        });
        const offer = await service.create(select({ locale: 'de' }));
        assert.equal(offer.promotionId, null);
        assert.equal(offer.priceBreakdown.effectiveNet, 49);
    });

    test('a promo code the promo module accepts, on the plan price after its promotion', async () => {
        const { service } = buildOfferService({
            promotions: fakePromotionRepo([promotion({ id: 'spring' })]),
        });
        const offer = await service.create(select({ promoCode: START10.code }));
        // 49 − 9.80 promotion = 39.20 net, 46.65 gross; ten per cent of that is 3.92 net.
        assert.equal(offer.promoCodeSnapshot.resolvedAmountNet, 3.92);
        assert.equal(offer.priceBreakdown.effectiveNet, 35.28);
        assert.equal(offer.priceBreakdown.effectiveGross, 41.98);
    });
});

describe('what cannot be priced is refused, not priced at nothing', () => {
    const PLAN_NOT_OFFERED = 'CHECKOUT_OFFER_PLAN_NOT_OFFERED';
    const BUNDLE_NOT_OFFERED = 'CHECKOUT_OFFER_BUNDLE_NOT_OFFERED';

    test('a plan with no version on sale', async () => {
        const { service } = buildOfferService({ plans: fakePlanRepo({ versions: [] }) });
        await assert.rejects(() => service.create(select()), refusedWith(PLAN_NOT_OFFERED));
    });

    test('a plan that is not marketed', async () => {
        const { service } = buildOfferService({
            plans: fakePlanRepo({ versions: [{ ...PLAN_VERSION, marketed: false }] }),
        });
        await assert.rejects(
            () => service.create(select()),
            refusedWith(PLAN_NOT_OFFERED, { planKey: 'STANDARD', billingCycle: 'monthly' }),
        );
    });

    test('a plan without a price for the rhythm', async () => {
        const { service } = buildOfferService({
            plans: fakePlanRepo({ versions: [{ ...PLAN_VERSION, yearlyNet: null }] }),
        });
        await assert.rejects(
            () => service.create(select({ billingCycle: 'yearly' })),
            refusedWith(PLAN_NOT_OFFERED, { billingCycle: 'yearly' }),
        );
    });

    for (const [reason, bundle] of [
        ['missing', null],
        ['superseded', { ...BUNDLE_VERSION, supersededAt: '2026-02-01T00:00:00.000Z' }],
        ['not_published', { ...BUNDLE_VERSION, publishedAt: null }],
        ['not_marketed', { ...BUNDLE_VERSION, marketed: false }],
        ['incompatible_with_plan', { ...BUNDLE_VERSION, compatibility: { planIds: ['PREMIUM'] } }],
        ['not_priced', { ...BUNDLE_VERSION, monthlyNet: null }],
    ]) {
        test(`an add-on that is ${reason}`, async () => {
            const { service } = buildOfferService({
                bundles: fakeBundleRepo(bundle ? [bundle] : []),
            });
            await assert.rejects(
                () => service.create(select({ bundleVersionIds: [BUNDLE_VERSION.id] })),
                refusedWith(BUNDLE_NOT_OFFERED, { bundleVersionId: BUNDLE_VERSION.id, reason }),
            );
        });
    }

    test('the same add-on twice', async () => {
        const { service } = buildOfferService();
        await assert.rejects(
            () =>
                service.create(
                    select({ bundleVersionIds: [BUNDLE_VERSION.id, BUNDLE_VERSION.id] }),
                ),
            refusedWith(BUNDLE_NOT_OFFERED, { reason: 'duplicate' }),
        );
    });

    test('a promo code the promo module refuses', async () => {
        const { service } = buildOfferService();
        await assert.rejects(
            () => service.create(select({ promoCode: 'NOPE' })),
            refusedWith('CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED', { reason: 'NOT_FOUND' }),
        );
    });

    test('a promo code where no promo module is registered to check it', async () => {
        const { service } = buildOfferService({ promoCodes: null });
        await assert.rejects(
            () => service.create(select({ promoCode: START10.code })),
            refusedWith('CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED', {
                reason: 'PROMO_CODES_NOT_AVAILABLE',
            }),
        );
    });

    test('the module does not start without a plan repository to price from', () => {
        assert.throws(
            () => CheckoutOfferModule.forRoot({ checkoutOfferRepository: {} }),
            /planRepository/,
        );
    });
});

describe('an offer becomes a contract only with the amounts the catalogue gave it', () => {
    const NOT_CURRENT = 'CHECKOUT_OFFER_PRICE_NOT_CURRENT';

    async function storedOffer(overrides = {}, extra = {}) {
        const built = buildOfferService(overrides);
        const offer = await built.service.create(
            select({ bundleVersionIds: [BUNDLE_VERSION.id], promoCode: START10.code, ...extra }),
        );
        return { ...built, offer, row: built.repo.rows.get(offer.id) };
    }

    test('an offer as priced is consumed', async () => {
        const { service, offer } = await storedOffer({
            promotions: fakePromotionRepo([promotion({ id: 'spring' })]),
        });
        assert.equal((await service.consume(offer.id)).status, 'consumed');
    });

    for (const [what, tamper] of [
        ['a lower total', (row) => (row.priceBreakdown.effectiveNet = 1)],
        ['a cheaper plan line', (row) => (row.lineItems[0].priceNet = 1)],
        ['a larger discount snapshot', (row) => (row.promoCodeSnapshot.resolvedAmountNet = 40)],
        [
            'an invented promotion',
            (row) => row.promotionSnapshots.push({ id: 'x', resolvedAmountNet: 30 }),
        ],
        ['a different plan version', (row) => (row.planVersionId = 'pv-other')],
        ['no plan version at all', (row) => (row.planVersionId = null)],
    ]) {
        test(`${what} written into the stored row is refused`, async () => {
            const { service, offer, row } = await storedOffer();
            tamper(row);
            await assert.rejects(() => service.consume(offer.id), refusedWith(NOT_CURRENT));
            assert.equal(row.status, 'open');
        });
    }

    test('a promotion that starts after the offer was priced does not unsettle it', async () => {
        const promotions = [];
        const { service, offer } = await storedOffer({ promotions: fakePromotionRepo(promotions) });
        promotions.push(promotion({ id: 'later', validFrom: '2098-01-01' }));
        assert.equal((await service.consume(offer.id)).status, 'consumed');
    });

    test('a promo code the promo module no longer accepts is refused at consumption', async () => {
        const accepted = [START10];
        const { service, offer } = await storedOffer({ promoCodes: fakePromoCodes(accepted) });
        accepted.pop();
        await assert.rejects(() => service.consume(offer.id), refusedWith(NOT_CURRENT));
    });

    test('an add-on renamed after the offer keeps the offer valid', async () => {
        const bundle = { ...BUNDLE_VERSION };
        const { service, offer } = await storedOffer({ bundles: fakeBundleRepo([bundle]) });
        bundle.label = 'Finance Plus (renamed)';
        assert.equal((await service.consume(offer.id)).status, 'consumed');
    });
});

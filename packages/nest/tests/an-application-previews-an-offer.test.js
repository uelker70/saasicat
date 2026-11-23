// @requirement SC-MKT-031 — An application previews what a checkout offer costs, and the preview stores nothing

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { PlanCatalogModule } from '../dist/billing/index.js';
import {
    CheckoutOfferModule,
    CheckoutOfferPricing,
    CheckoutOfferService,
} from '../dist/checkout-offer/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import { storeSecretsInPlainText } from '../dist/index.js';

import {
    BUNDLE_VERSION,
    START10,
    buildOfferService,
    fakeBundleRepo,
    fakeOfferRepo,
    fakePlanRepo,
    fakePromotionRepo,
} from './helpers/checkout-catalogue.js';
import { MemoryPromoCodes, promoCodesOver } from './helpers/promo-slots.js';
import { TAX_SETTINGS, taxesDeciding } from './helpers/tax-adapter.js';

const NOW = new Date('2026-11-22T10:00:00.000Z');

/** Twenty per cent off STANDARD until the end of November. */
const NOVEMBER_PROMOTION = {
    id: 'november',
    internalLabel: 'November',
    type: 'percent',
    value: 20,
    appliesTo: ['STANDARD'],
    targetType: 'PLAN',
    billingCycle: 'both',
    validFrom: '2026-11-01',
    validTo: '2026-11-30',
    priority: 1,
    onlyLocales: null,
    requiresCoupon: false,
    codes: [],
    color: '#000',
    i18n: { de: { badge: '20 % im November' } },
};

/** A selection as `CheckoutOfferService.create` takes it. */
const selection = (extra = {}) => ({ planKey: 'STANDARD', billingCycle: 'monthly', ...extra });

/** The same selection as the preview takes it, with the defaults `create` applies. */
const previewOf = (chosen) => ({
    planKey: chosen.planKey,
    billingCycle: chosen.billingCycle,
    bundleVersionIds: chosen.bundleVersionIds ?? [],
    promoCode: chosen.promoCode ?? null,
    locale: chosen.locale ?? 'de',
});

/** What an offer carries that the pricing computed. */
function pricedPartOf(offer) {
    return {
        planVersionId: offer.planVersionId,
        bundles: offer.bundles,
        bundleVersionIds: offer.bundleVersionIds,
        promotionId: offer.promotionId,
        promoCode: offer.promoCode,
        priceBreakdown: offer.priceBreakdown,
        lineItems: offer.lineItems,
        promotionSnapshots: offer.promotionSnapshots,
        promoCodeSnapshot: offer.promoCodeSnapshot,
    };
}

// An application's own checkout, injecting the preview as any other service.
class ApplicationCheckout {
    constructor(pricing, offers) {
        this.pricing = pricing;
        this.offers = offers;
    }
}
Injectable()(ApplicationCheckout);
Inject(CheckoutOfferPricing)(ApplicationCheckout, undefined, 0);
Inject(CheckoutOfferService)(ApplicationCheckout, undefined, 1);

class ApplicationCheckoutModule {}
Module({ providers: [ApplicationCheckout] })(ApplicationCheckoutModule);

class AllowAll {
    canActivate() {
        return true;
    }
}

const CATALOGUE = {
    schemaVersion: 1,
    app: { name: 'TestApp', version: '0.0.1' },
    currency: 'EUR',
    vatRate: 19,
    plans: [],
};

const checkoutOfferOptions = () => ({
    checkoutOfferRepository: fakeOfferRepo(),
    planRepository: fakePlanRepo(),
    bundleRepository: fakeBundleRepo(),
    promotionRepository: fakePromotionRepo([NOVEMBER_PROMOTION]),
});

describe('an application injects the preview of an offer', () => {
    const compositions = [
        [
            'under SaaSiCatModule.forRoot',
            () => [
                SaaSiCatModule.forRoot({
                    planCatalog: CATALOGUE,
                    controller: { guards: [AllowAll] },
                    discoverySnapshotPath: null,
                    adapters: {
                        secretSealer: storeSecretsInPlainText(),
                        mfa: { getSecret: async () => null, setSecret: async () => {} },
                        audit: { write: async () => {} },
                        rlsBypass: { runWithBypass: (fn) => fn() },
                    },
                    checkoutOffer: checkoutOfferOptions(),
                }),
                ApplicationCheckoutModule,
            ],
        ],
        [
            'beside CheckoutOfferModule.forRoot, imported by the application',
            () => {
                class StandaloneCheckoutModule {}
                Module({
                    imports: [CheckoutOfferModule.forRoot(checkoutOfferOptions())],
                    providers: [ApplicationCheckout],
                })(StandaloneCheckoutModule);
                return [PlanCatalogModule.forRootWithCatalog(CATALOGUE), StandaloneCheckoutModule];
            },
        ],
    ];

    for (const [where, imports] of compositions) {
        test(`${where}, and it prices what the offer carries`, async (t) => {
            t.mock.timers.enable({ apis: ['Date'], now: NOW });
            const moduleRef = await Test.createTestingModule({ imports: imports() }).compile();
            try {
                const checkout = moduleRef.get(ApplicationCheckout, { strict: false });
                assert.ok(checkout.pricing instanceof CheckoutOfferPricing);
                const chosen = selection({ bundleVersionIds: [BUNDLE_VERSION.id] });

                const preview = await checkout.pricing.price(previewOf(chosen));
                const offer = await checkout.offers.create(chosen);

                assert.deepEqual(preview, pricedPartOf(offer));
                assert.equal(preview.promotionId, NOVEMBER_PROMOTION.id);
            } finally {
                await moduleRef.close();
            }
        });
    }
});

describe('the preview is what an offer created from the same selection carries', () => {
    const cases = [
        ['the plan alone', {}, selection()],
        [
            'plan, add-on, promotion and promo code',
            { promotions: fakePromotionRepo([NOVEMBER_PROMOTION]) },
            selection({ bundleVersionIds: [BUNDLE_VERSION.id], promoCode: START10.code }),
        ],
        [
            'a yearly rhythm with its add-on',
            {},
            selection({ billingCycle: 'yearly', bundleVersionIds: [BUNDLE_VERSION.id] }),
        ],
        [
            'where a tax adapter decides the rate',
            { catalog: { currency: 'EUR', ...TAX_SETTINGS }, taxes: taxesDeciding() },
            selection({ promoCode: START10.code }),
        ],
    ];

    for (const [what, overrides, chosen] of cases) {
        test(`${what}: the preview equals the offer`, async (t) => {
            t.mock.timers.enable({ apis: ['Date'], now: NOW });
            const { pricing, service } = buildOfferService(overrides);

            const preview = await pricing.price(previewOf(chosen));
            const offer = await service.create(chosen);

            assert.deepEqual(preview, pricedPartOf(offer));
        });
    }

    test('the combined case carries each part it names', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: NOW });
        const { pricing } = buildOfferService({
            promotions: fakePromotionRepo([NOVEMBER_PROMOTION]),
        });

        const preview = await pricing.price(
            previewOf(
                selection({ bundleVersionIds: [BUNDLE_VERSION.id], promoCode: START10.code }),
            ),
        );

        assert.deepEqual(preview.bundleVersionIds, [BUNDLE_VERSION.id]);
        assert.equal(preview.promotionId, NOVEMBER_PROMOTION.id);
        assert.equal(preview.promoCodeSnapshot?.code, START10.code);
    });
});

describe('what the preview writes', () => {
    function previewing() {
        const checks = [];
        const codes = new MemoryPromoCodes();
        const code = codes.add({ code: START10.code });
        const promo = promoCodesOver({
            codes,
            validationLog: {
                log: async (entry) => checks.push(entry),
                countValid: async () => 0,
            },
        });
        const built = buildOfferService({ promoCodes: promo.service });
        return { ...built, ...promo, code, checks };
    }

    test('with a promo code, the check of the code and nothing else', async () => {
        const { pricing, repo, codes, redemptions, code, checks } = previewing();

        const preview = await pricing.price(previewOf(selection({ promoCode: START10.code })));

        assert.equal(preview.promoCodeSnapshot?.code, START10.code);
        assert.deepEqual(
            checks.map(({ promoCodeId, codeAttempt, result }) => ({
                promoCodeId,
                codeAttempt,
                result,
            })),
            [{ promoCodeId: code.id, codeAttempt: START10.code, result: 'VALID' }],
        );
        assert.equal(repo.rows.size, 0, 'no offer is stored');
        assert.equal(codes.heldBy.size, 0, 'no slot is held');
        assert.equal((await codes.findById(code.id)).heldCount, 0);
        assert.equal((await codes.findById(code.id)).redemptionsCount, 0);
        assert.deepEqual(redemptions.rows, [], 'nothing is redeemed');
    });

    test('a refused promo code is recorded as an attempt, and the preview refuses', async () => {
        const { pricing, repo, checks } = previewing();

        await assert.rejects(
            () => pricing.price(previewOf(selection({ promoCode: 'UNKNOWN1' }))),
            (error) => error.response?.code === 'CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED',
        );
        assert.deepEqual(
            checks.map(({ codeAttempt, result }) => ({ codeAttempt, result })),
            [{ codeAttempt: 'UNKNOWN1', result: 'NOT_FOUND' }],
        );
        assert.equal(repo.rows.size, 0);
    });

    test('without a promo code, nothing at all', async () => {
        const { pricing, repo, checks } = previewing();

        await pricing.price(previewOf(selection({ bundleVersionIds: [BUNDLE_VERSION.id] })));

        assert.deepEqual(checks, []);
        assert.equal(repo.rows.size, 0);
    });
});

describe('the preview refuses what creating the offer refuses', () => {
    const TOURNAMENTS = {
        ...BUNDLE_VERSION,
        id: 'bv-tournaments',
        bundleId: 'b-tournaments',
        bundleKey: 'TOURNAMENTS',
        features: ['TOURNAMENT_MANAGEMENT'],
    };
    const RESOURCES = {
        ...BUNDLE_VERSION,
        id: 'bv-resources',
        bundleId: 'b-resources',
        bundleKey: 'RESOURCES',
        features: ['RESOURCE_MANAGEMENT'],
    };
    /** Tournaments need resources, which neither the plan nor the tournaments add-on has. */
    const catalogEntries = {
        listFeatures: async () => [
            { featureKey: 'TOURNAMENT_MANAGEMENT', requires: ['RESOURCE_MANAGEMENT'] },
        ],
    };
    const built = () =>
        buildOfferService({ bundles: fakeBundleRepo([TOURNAMENTS, RESOURCES]), catalogEntries });

    /** The refusal `run` throws, as a response body. */
    async function refusalOf(run) {
        try {
            await run();
        } catch (error) {
            return error.getResponse();
        }
        assert.fail('expected a refusal');
    }

    for (const [what, chosen, code] of [
        [
            'an add-on whose feature needs one the selection lacks',
            selection({ bundleVersionIds: [TOURNAMENTS.id] }),
            'CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED',
        ],
        [
            'a promo code the promo module does not accept',
            selection({ promoCode: 'UNKNOWN1' }),
            'CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED',
        ],
        [
            'an add-on that is not in the catalogue',
            selection({ bundleVersionIds: ['bv-missing'] }),
            'CHECKOUT_OFFER_BUNDLE_NOT_OFFERED',
        ],
    ]) {
        test(`${what}: both refuse alike`, async () => {
            const { pricing, service, repo } = built();

            const previewRefusal = await refusalOf(() => pricing.price(previewOf(chosen)));
            const createRefusal = await refusalOf(() => service.create(chosen));

            assert.equal(previewRefusal.code, code);
            assert.deepEqual(previewRefusal, createRefusal);
            assert.equal(repo.rows.size, 0);
        });
    }

    test('the unmet dependency is named', async () => {
        const { pricing } = built();

        const refusal = await refusalOf(() =>
            pricing.price(previewOf(selection({ bundleVersionIds: [TOURNAMENTS.id] }))),
        );

        assert.deepEqual(refusal.missingRequires, ['RESOURCE_MANAGEMENT']);
    });

    test('a selection that brings the needed feature is priced', async () => {
        const { pricing, service } = built();
        const chosen = selection({ bundleVersionIds: [TOURNAMENTS.id, RESOURCES.id] });

        const preview = await pricing.price(previewOf(chosen));
        const offer = await service.create(chosen);

        assert.deepEqual(preview.bundleVersionIds, [TOURNAMENTS.id, RESOURCES.id]);
        assert.equal(offer.status, 'open');
    });
});

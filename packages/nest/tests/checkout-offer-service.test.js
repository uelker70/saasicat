import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    BUNDLE_VERSION,
    PLAN_VERSION,
    buildOfferService,
    fakeBundleRepo,
    fakePlanRepo,
} from './helpers/checkout-catalogue.js';

// CheckoutOfferService — package snapshot website → onboarding → billing,
// against an in-memory store and the small catalogue in the helper.

// @requirement SC-MKT-013 — What a customer selected is frozen into an offer before it becomes a contract
// @requirement SC-MKT-014 — An offer that has expired or been used cannot become a contract
// @requirement SC-MKT-017 — One offer yields at most one contract, and only once its prices are frozen
describe('CheckoutOfferService', () => {
    const select = (extra = {}) => ({ planKey: 'STANDARD', billingCycle: 'monthly', ...extra });

    test('create creates an open offer with a frozen plan line', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select());
        assert.equal(offer.status, 'open');
        assert.equal(offer.consumedAt, null);
        assert.equal(offer.planKey, 'STANDARD');
        assert.equal(offer.planVersionId, PLAN_VERSION.id);
        assert.deepEqual(
            offer.lineItems.map((item) => [item.kind, item.sourceVersionId]),
            [['plan', PLAN_VERSION.id]],
        );
    });

    test('update adds an add-on and prices the offer again', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select());
        const updated = await service.update(offer.id, { bundleVersionIds: [BUNDLE_VERSION.id] });
        assert.deepEqual(updated.bundles, ['FINANCE_PLUS']);
        assert.deepEqual(updated.bundleVersionIds, [BUNDLE_VERSION.id]);
        assert.equal(updated.priceBreakdown.bundlesNet, 12);
        assert.equal(updated.priceBreakdown.regularNet, 61);
    });

    test('every selected bundle version carries its own frozen line', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select({ bundleVersionIds: [BUNDLE_VERSION.id] }));
        assert.deepEqual(
            offer.lineItems.map((item) => [item.kind, item.sourceKey, item.sourceVersionId]),
            [
                ['plan', 'STANDARD', PLAN_VERSION.id],
                ['bundle', 'FINANCE_PLUS', BUNDLE_VERSION.id],
            ],
        );
    });

    test('a promo code becomes a negative discount line, and removing it removes the line', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select({ promoCode: 'start10' }));

        const discount = offer.lineItems.find((item) => item.kind === 'discount');
        assert.ok(discount);
        assert.equal(offer.promoCode, 'START10');
        assert.equal(discount.sourceKey, 'START10');
        assert.equal(discount.titleSnapshot, '10 % Start');
        assert.equal(discount.priceNet, -4.9);
        assert.equal(discount.priceGross, -5.83);
        assert.equal(discount.metadata.source, 'promo_code');

        const withoutCode = await service.update(offer.id, { promoCode: null });
        assert.equal(withoutCode.promoCode, null);
        assert.equal(
            withoutCode.lineItems.some((item) => item.kind === 'discount'),
            false,
        );
    });

    test('consume freezes the offer', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select());
        const consumed = await service.consume(offer.id);
        assert.equal(consumed.status, 'consumed');
        assert.ok(consumed.consumedAt);
    });

    // @requirement SC-MKT-016 — An offer cannot be turned into a contract if part of it is no longer on sale
    test('consume blocks a bundle version that went off sale after the offer was made', async () => {
        const bundle = { ...BUNDLE_VERSION };
        const { service } = buildOfferService({ bundles: fakeBundleRepo([bundle]) });
        const offer = await service.create(select({ bundleVersionIds: [bundle.id] }));
        bundle.supersededAt = '2026-05-01T00:00:00.000Z';

        await assert.rejects(
            () => service.consume(offer.id),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE');
                assert.equal(err.response?.violations[0].reason, 'superseded');
                return true;
            },
        );
    });

    test('update on a consumed offer throws Conflict', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select());
        await service.consume(offer.id);
        await assert.rejects(
            () => service.update(offer.id, { locale: 'en' }),
            /already been consumed/,
        );
    });

    test('update on an expired offer throws Conflict', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select({ validUntil: '2020-01-01T00:00:00.000Z' }));
        await assert.rejects(() => service.update(offer.id, { locale: 'en' }), /has expired/);
    });

    test('double consume throws Conflict', async () => {
        const { service } = buildOfferService();
        const offer = await service.create(select());
        await service.consume(offer.id);
        await assert.rejects(() => service.consume(offer.id), /already been consumed/);
    });

    test('getById throws for an unknown offer', async () => {
        const { service } = buildOfferService();
        await assert.rejects(() => service.getById('nope'), /not found/);
    });
});

// #35 P6 — server-side requires validation on create/update: the
// dependencies of all features (plan ∪ selected bundles) must be covered
// within the selection. requires source = curated FeatureCatalogEntries.
// @requirement SC-MKT-015 — An offer whose selection does not cover its own dependencies is refused
describe('CheckoutOfferService — requires validation (#35 P6)', () => {
    const TURNIERE_BV = {
        ...BUNDLE_VERSION,
        id: 'bv-turniere',
        bundleKey: 'TURNIERE',
        features: ['TOURNAMENT_MANAGEMENT'],
    };
    const RESSOURCEN_BV = {
        ...BUNDLE_VERSION,
        id: 'bv-ressourcen',
        bundleKey: 'RESSOURCEN',
        features: ['RESOURCE_MANAGEMENT'],
    };

    function fakeCatalogEntryRepo(requiresByFeature) {
        return {
            listFeatures: async () =>
                Object.entries(requiresByFeature).map(([featureKey, requires]) => ({
                    featureKey,
                    requires,
                })),
        };
    }

    function buildService(requiresByFeature) {
        return buildOfferService({
            bundles: fakeBundleRepo([TURNIERE_BV, RESSOURCEN_BV]),
            plans: fakePlanRepo(),
            catalogEntries: requiresByFeature ? fakeCatalogEntryRepo(requiresByFeature) : null,
        }).service;
    }

    const offerData = (bundleVersions) => ({
        planKey: 'STANDARD',
        billingCycle: 'monthly',
        bundleVersionIds: bundleVersions.map((bv) => bv.id),
    });

    test('create throws 422 CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED for uncovered requires', async () => {
        const service = buildService({ TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'] });
        await assert.rejects(
            () => service.create(offerData([TURNIERE_BV])),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(err.response?.code, 'CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED');
                assert.deepEqual(err.response?.missingRequires, ['RESOURCE_MANAGEMENT']);
                return true;
            },
        );
    });

    test('create accepts when a second bundle covers the requires', async () => {
        const service = buildService({ TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'] });
        const offer = await service.create(offerData([TURNIERE_BV, RESSOURCEN_BV]));
        assert.equal(offer.status, 'open');
    });

    test('create accepts when the plan covers the requires', async () => {
        const service = buildService({ TOURNAMENT_MANAGEMENT: ['DASHBOARD'] });
        const offer = await service.create(offerData([TURNIERE_BV]));
        assert.equal(offer.status, 'open');
    });

    test('update validates the changed bundle selection against requires', async () => {
        const service = buildService({ TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'] });
        const offer = await service.create(offerData([TURNIERE_BV, RESSOURCEN_BV]));
        await assert.rejects(
            () => service.update(offer.id, { bundleVersionIds: [TURNIERE_BV.id] }),
            (err) => {
                assert.equal(err.response?.code, 'CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED');
                return true;
            },
        );
    });

    test('without a CatalogEntryRepository no validation happens (graceful)', async () => {
        const service = buildService(null);
        const offer = await service.create(offerData([TURNIERE_BV]));
        assert.equal(offer.status, 'open');
    });
});

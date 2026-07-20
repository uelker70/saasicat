import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CheckoutOfferService } from '../dist/checkout-offer/index.js';

// CheckoutOfferService — Paket-Snapshot Webseite → Onboarding → Abrechnung
// (METAMODELL §17a). Test gegen einen In-Memory-Fake.

const PRICE = {
    currency: 'EUR',
    billingCycle: 'monthly',
    planNet: 49,
    bundlesNet: 0,
    regularNet: 49,
    effectiveNet: 49,
    vatRate: 0.19,
    effectiveGross: 58.31,
};

const DISCOUNTED_PRICE = {
    ...PRICE,
    effectiveNet: 44.1,
    effectiveGross: 52.48,
};

const PLAN_LINE_ITEM = {
    kind: 'plan',
    sourceKey: 'STANDARD',
    sourceVersionId: 'pv-1',
    titleSnapshot: 'Standard',
    descriptionSnapshot: null,
    quantity: 1,
    unit: null,
    priceNet: 49,
    priceGross: 58.31,
    billingCycle: 'monthly',
    featuresSnapshot: ['DASHBOARD'],
    quotaEffectsSnapshot: { users: 5 },
    metadata: null,
};

const BUNDLE_LINE_ITEM = {
    kind: 'bundle',
    sourceKey: 'FINANCE_PLUS',
    sourceVersionId: 'bv-1',
    titleSnapshot: 'Finance Plus',
    descriptionSnapshot: null,
    quantity: 1,
    unit: null,
    priceNet: 12,
    priceGross: 14.28,
    billingCycle: 'monthly',
    featuresSnapshot: ['FINANCE_EXPORT'],
    quotaEffectsSnapshot: {},
    metadata: null,
};

function fakeRepo() {
    const map = new Map();
    let seq = 0;
    return {
        async list({ projectKey, status }) {
            return [...map.values()].filter(
                (o) => o.projectKey === projectKey && (!status || o.status === status),
            );
        },
        async findById(id) {
            return map.get(id) ?? null;
        },
        async create(data) {
            const id = `offer-${++seq}`;
            const now = new Date().toISOString();
            const row = {
                id,
                projectKey: data.projectKey,
                planKey: data.planKey,
                planVersionId: data.planVersionId ?? null,
                billingCycle: data.billingCycle,
                promotionId: data.promotionId ?? null,
                promoCode: data.promoCode ?? null,
                bundles: data.bundles ?? [],
                bundleVersionIds: data.bundleVersionIds ?? [],
                quotas: data.quotas ?? {},
                priceBreakdown: data.priceBreakdown,
                lineItems: data.lineItems ?? [],
                promotionSnapshots: data.promotionSnapshots ?? [],
                promoCodeSnapshot: data.promoCodeSnapshot ?? null,
                locale: data.locale ?? 'de',
                validUntil: data.validUntil ?? null,
                status: 'open',
                consumedAt: null,
                createdAt: now,
                updatedAt: now,
            };
            map.set(id, row);
            return row;
        },
        async update(id, data) {
            const row = map.get(id);
            Object.assign(row, data, { updatedAt: new Date().toISOString() });
            return row;
        },
        async consume(id) {
            const row = map.get(id);
            row.status = 'consumed';
            row.consumedAt = new Date().toISOString();
            return row;
        },
    };
}

function fakeBundleRepo(rows) {
    return {
        async findVersionById(id) {
            return rows.get(id) ?? null;
        },
    };
}

describe('CheckoutOfferService', () => {
    let repo;
    let service;

    beforeEach(() => {
        repo = fakeRepo();
        service = new CheckoutOfferService(repo);
    });

    function create() {
        return service.create({
            projectKey: 'clubapp',
            planKey: 'STANDARD',
            billingCycle: 'monthly',
            priceBreakdown: PRICE,
        });
    }

    test('create legt einen offenen Offer an', async () => {
        const offer = await create();
        assert.equal(offer.status, 'open');
        assert.equal(offer.consumedAt, null);
        assert.equal(offer.planKey, 'STANDARD');
        assert.equal(offer.lineItems[0].kind, 'plan');
    });

    test('update individualisiert einen offenen Offer', async () => {
        const offer = await create();
        const updated = await service.update(offer.id, { bundles: ['FINANCE_PLUS'] });
        assert.deepEqual(updated.bundles, ['FINANCE_PLUS']);
    });

    test('create verlangt Bundle-LineItems für konkrete BundleVersionen', async () => {
        await assert.rejects(
            () =>
                service.create({
                    projectKey: 'clubapp',
                    planKey: 'STANDARD',
                    billingCycle: 'monthly',
                    bundleVersionIds: ['bv-1'],
                    priceBreakdown: PRICE,
                    lineItems: [PLAN_LINE_ITEM],
                }),
            /Bundle-LineItem/,
        );
    });

    test('create friert Bundle-Versionen, Promotions und PromoCode im Offer ein', async () => {
        const offer = await service.create({
            projectKey: 'clubapp',
            planKey: 'STANDARD',
            planVersionId: 'pv-1',
            billingCycle: 'monthly',
            bundles: ['FINANCE_PLUS'],
            bundleVersionIds: ['bv-1'],
            priceBreakdown: PRICE,
            lineItems: [PLAN_LINE_ITEM, BUNDLE_LINE_ITEM],
            promotionSnapshots: [
                {
                    id: 'promo-1',
                    type: 'percent',
                    value: 10,
                    label: '10 % Start',
                    resolvedAmountNet: 4.9,
                    appliesTo: ['STANDARD'],
                    billingCycle: 'monthly',
                },
            ],
            promoCodeSnapshot: {
                code: 'START10',
                label: '10 % Start',
                valueType: 'PERCENT',
                value: 10,
                resolvedAmountNet: 4.9,
            },
        });
        assert.deepEqual(offer.bundleVersionIds, ['bv-1']);
        assert.equal(offer.lineItems.length, 2);
        assert.equal(offer.promotionSnapshots[0].id, 'promo-1');
        assert.equal(offer.promoCodeSnapshot.code, 'START10');
    });

    test('create ergänzt rabattierten Preis als negative Discount-LineItem', async () => {
        const offer = await service.create({
            projectKey: 'clubapp',
            planKey: 'STANDARD',
            planVersionId: 'pv-1',
            billingCycle: 'monthly',
            priceBreakdown: DISCOUNTED_PRICE,
            lineItems: [PLAN_LINE_ITEM],
            promoCodeSnapshot: {
                code: 'START10',
                label: '10 % Start',
                valueType: 'PERCENT',
                value: 10,
                resolvedAmountNet: 4.9,
            },
        });

        const discount = offer.lineItems.find((item) => item.kind === 'discount');
        assert.ok(discount);
        assert.equal(offer.lineItems.length, 2);
        assert.equal(discount.sourceKey, 'START10');
        assert.equal(discount.titleSnapshot, '10 % Start');
        assert.equal(discount.priceNet, -4.9);
        assert.equal(discount.priceGross, -5.83);
        assert.equal(discount.metadata.source, 'promo_code');

        const withoutDiscount = await service.update(offer.id, {
            priceBreakdown: PRICE,
            promoCodeSnapshot: null,
        });
        assert.equal(
            withoutDiscount.lineItems.some((item) => item.kind === 'discount'),
            false,
        );
    });

    test('consume friert den Offer ein', async () => {
        const offer = await create();
        const consumed = await service.consume(offer.id);
        assert.equal(consumed.status, 'consumed');
        assert.ok(consumed.consumedAt);
    });

    test('consume blockt nicht mehr buchbare BundleVersion', async () => {
        const bundleRows = new Map([
            [
                'bv-1',
                {
                    id: 'bv-1',
                    publishedAt: '2026-01-01T00:00:00.000Z',
                    supersededAt: '2026-05-01T00:00:00.000Z',
                    validFrom: '2026-01-01T00:00:00.000Z',
                    validUntil: null,
                },
            ],
        ]);
        service = new CheckoutOfferService(repo, fakeBundleRepo(bundleRows));
        const offer = await service.create({
            projectKey: 'clubapp',
            planKey: 'STANDARD',
            billingCycle: 'monthly',
            bundleVersionIds: ['bv-1'],
            priceBreakdown: PRICE,
            lineItems: [PLAN_LINE_ITEM, BUNDLE_LINE_ITEM],
        });

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

    test('update auf verbrauchtem Offer wirft Conflict', async () => {
        const offer = await create();
        await service.consume(offer.id);
        await assert.rejects(
            () => service.update(offer.id, { bundles: ['X'] }),
            /bereits verbraucht/,
        );
    });

    test('update auf abgelaufenem Offer wirft Conflict', async () => {
        const offer = await service.create({
            projectKey: 'clubapp',
            planKey: 'STANDARD',
            billingCycle: 'monthly',
            priceBreakdown: PRICE,
            validUntil: '2020-01-01T00:00:00.000Z',
        });
        await assert.rejects(() => service.update(offer.id, { locale: 'en' }), /abgelaufen/);
    });

    test('doppeltes consume wirft Conflict', async () => {
        const offer = await create();
        await service.consume(offer.id);
        await assert.rejects(() => service.consume(offer.id), /bereits verbraucht/);
    });

    test('getById wirft bei unbekanntem Offer', async () => {
        await assert.rejects(() => service.getById('nope'), /nicht gefunden/);
    });
});

// #35 P6 — serverseitige requires-Validierung beim Anlegen/Ändern: die
// Abhängigkeiten aller Features (Plan ∪ gewählte Bundles) müssen innerhalb
// der Auswahl gedeckt sein. requires-Quelle = kuratierte FeatureCatalogEntries.
describe('CheckoutOfferService — requires-Validierung (#35 P6)', () => {
    const PLAN_VERSION = { id: 'pv-1', planId: 'STANDARD', features: ['DASHBOARD'] };
    const TURNIERE_BV = { id: 'bv-turniere', features: ['TOURNAMENT_MANAGEMENT'] };
    const RESSOURCEN_BV = { id: 'bv-ressourcen', features: ['RESOURCE_MANAGEMENT'] };

    function fakePlanRepo() {
        return {
            async findVersionById(id) {
                return id === PLAN_VERSION.id ? PLAN_VERSION : null;
            },
            async findActivePlanVersion(planKey) {
                return planKey === 'STANDARD' ? PLAN_VERSION : null;
            },
        };
    }

    function fakeCatalogEntryRepo(requiresByFeature) {
        return {
            listFeatures: async () =>
                Object.entries(requiresByFeature).map(([featureKey, requires]) => ({
                    featureKey,
                    requires,
                })),
        };
    }

    function bundleLineItem(bv) {
        return {
            ...BUNDLE_LINE_ITEM,
            sourceKey: bv.id,
            sourceVersionId: bv.id,
            featuresSnapshot: bv.features,
        };
    }

    let repo;

    beforeEach(() => {
        repo = fakeRepo();
    });

    function buildService(requiresByFeature) {
        return new CheckoutOfferService(
            repo,
            fakeBundleRepo(new Map([
                [TURNIERE_BV.id, TURNIERE_BV],
                [RESSOURCEN_BV.id, RESSOURCEN_BV],
            ])),
            fakePlanRepo(),
            fakeCatalogEntryRepo(requiresByFeature),
        );
    }

    function offerData(bundleVersions) {
        return {
            projectKey: 'clubapp',
            planKey: 'STANDARD',
            planVersionId: PLAN_VERSION.id,
            billingCycle: 'monthly',
            bundleVersionIds: bundleVersions.map((bv) => bv.id),
            priceBreakdown: PRICE,
            lineItems: [PLAN_LINE_ITEM, ...bundleVersions.map(bundleLineItem)],
        };
    }

    test('create wirft 422 CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED bei ungedeckten requires', async () => {
        const service = buildService({ TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'] });
        await assert.rejects(
            () => service.create(offerData([TURNIERE_BV])),
            (err) => {
                assert.equal(err.status, 422);
                assert.equal(
                    err.response?.code,
                    'CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED',
                );
                assert.deepEqual(err.response?.missingRequires, ['RESOURCE_MANAGEMENT']);
                return true;
            },
        );
    });

    test('create akzeptiert, wenn ein zweites Bundle die requires deckt', async () => {
        const service = buildService({ TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'] });
        const offer = await service.create(offerData([TURNIERE_BV, RESSOURCEN_BV]));
        assert.equal(offer.status, 'open');
    });

    test('create akzeptiert, wenn der Plan die requires deckt', async () => {
        const service = buildService({ TOURNAMENT_MANAGEMENT: ['DASHBOARD'] });
        const offer = await service.create(offerData([TURNIERE_BV]));
        assert.equal(offer.status, 'open');
    });

    test('update validiert die geänderte Bundle-Auswahl gegen requires', async () => {
        const service = buildService({ TOURNAMENT_MANAGEMENT: ['RESOURCE_MANAGEMENT'] });
        const offer = await service.create(offerData([TURNIERE_BV, RESSOURCEN_BV]));
        await assert.rejects(
            () =>
                service.update(offer.id, {
                    bundleVersionIds: [TURNIERE_BV.id],
                    lineItems: [PLAN_LINE_ITEM, bundleLineItem(TURNIERE_BV)],
                }),
            (err) => {
                assert.equal(
                    err.response?.code,
                    'CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED',
                );
                return true;
            },
        );
    });

    test('ohne CatalogEntryRepository wird nicht validiert (graceful)', async () => {
        const service = new CheckoutOfferService(
            repo,
            fakeBundleRepo(new Map([[TURNIERE_BV.id, TURNIERE_BV]])),
            fakePlanRepo(),
            null,
        );
        const offer = await service.create(offerData([TURNIERE_BV]));
        assert.equal(offer.status, 'open');
    });

    test('ohne PlanRepository deckt die featuresSnapshot der Plan-LineItem (Fallback)', async () => {
        const service = new CheckoutOfferService(
            repo,
            fakeBundleRepo(new Map([[TURNIERE_BV.id, TURNIERE_BV]])),
            null,
            fakeCatalogEntryRepo({ TOURNAMENT_MANAGEMENT: ['DASHBOARD'] }),
        );
        // PLAN_LINE_ITEM.featuresSnapshot enthält DASHBOARD → gedeckt.
        const offer = await service.create(offerData([TURNIERE_BV]));
        assert.equal(offer.status, 'open');
    });
});

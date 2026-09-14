// A small catalogue and an in-memory offer store for checkout offer tests.
//
// The catalogue is what an offer is priced from: one plan version at 49/490
// net, one add-on at 12/120 net, a 19 % VAT rate, and a promo code worth ten
// per cent. Each piece can be replaced per test, so a case states the one fact
// it is about and inherits the rest.

import { CheckoutOfferPricing, CheckoutOfferService } from '../../dist/checkout-offer/index.js';

export const CATALOG = { vatRate: 19, currency: 'EUR' };

export const PLAN = { id: 'plan-standard', planKey: 'STANDARD', label: 'Standard' };

export const PLAN_VERSION = {
    id: 'pv-1',
    planId: 'STANDARD',
    features: ['DASHBOARD'],
    quotas: { users: 5 },
    monthlyNet: '49.00',
    yearlyNet: '490.00',
    marketed: true,
    publishedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: null,
};

export const BUNDLE_VERSION = {
    id: 'bv-1',
    bundleKey: 'FINANCE_PLUS',
    label: 'Finance Plus',
    features: ['FINANCE_EXPORT'],
    quotas: {},
    compatibility: { planIds: [] },
    pricingOverrides: [],
    monthlyNet: '12.00',
    yearlyNet: '120.00',
    marketed: true,
    publishedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: null,
};

/** A promo code the promo module accepts: ten per cent, once. */
export const START10 = {
    valid: true,
    code: 'START10',
    label: '10 % Start',
    discount: { valueType: 'PERCENT', value: '10.00', durationType: 'ONCE', durationValue: null },
};

export function fakeOfferRepo() {
    const rows = new Map();
    /** The transaction each consume ran on, by offer id. */
    const consumedOn = new Map();
    let seq = 0;
    const stamp = () => new Date().toISOString();
    return {
        rows,
        consumedOn,
        async list({ status }) {
            return [...rows.values()].filter((o) => !status || o.status === status);
        },
        async findById(id) {
            return rows.get(id) ?? null;
        },
        async create(data) {
            const id = `offer-${++seq}`;
            const row = {
                id,
                promotionId: null,
                promoCode: null,
                bundles: [],
                bundleVersionIds: [],
                lineItems: [],
                promotionSnapshots: [],
                promoCodeSnapshot: null,
                locale: 'de',
                validUntil: null,
                ...structuredClone(data),
                status: 'open',
                consumedAt: null,
                createdAt: stamp(),
                updatedAt: stamp(),
            };
            rows.set(id, row);
            return structuredClone(row);
        },
        async update(id, data) {
            const row = rows.get(id);
            Object.assign(row, structuredClone(data), { updatedAt: stamp() });
            return structuredClone(row);
        },
        // As the port has it: the write decides whether the offer is still open.
        async consume(id, tx) {
            const row = rows.get(id);
            if (row.status !== 'open') throw new Error(`Checkout offer '${id}' is not open`);
            consumedOn.set(id, tx);
            row.status = 'consumed';
            row.consumedAt = stamp();
            return structuredClone(row);
        },
    };
}

export function fakePlanRepo({ versions = [PLAN_VERSION], plans = [PLAN] } = {}) {
    return {
        async findByKey(planKey) {
            return plans.find((p) => p.planKey === planKey) ?? null;
        },
        async findVersionById(id) {
            return versions.find((v) => v.id === id) ?? null;
        },
        async findActivePlanVersion(planKey) {
            return versions.find((v) => v.planId === planKey && v.supersededAt === null) ?? null;
        },
    };
}

export function fakeBundleRepo(versions = [BUNDLE_VERSION]) {
    return {
        async findVersionById(id) {
            return versions.find((v) => v.id === id) ?? null;
        },
    };
}

export function fakePromotionRepo(promotions = []) {
    return { list: async () => promotions };
}

/** Accepts the codes given, refuses every other one as the promo module would. */
export function fakePromoCodes(accepted = [START10]) {
    return {
        async preview({ code }) {
            const found = accepted.find((c) => c.code === code.trim().toUpperCase());
            return found ?? { valid: false, reason: 'NOT_FOUND' };
        },
    };
}

/** The service with every dependency the catalogue above describes; override any of them. */
export function buildOfferService(overrides = {}) {
    const deps = {
        repo: fakeOfferRepo(),
        catalog: CATALOG,
        plans: fakePlanRepo(),
        bundles: fakeBundleRepo(),
        promotions: fakePromotionRepo(),
        promoCodes: fakePromoCodes(),
        catalogEntries: null,
        contracts: null,
        transactions: null,
        ...overrides,
    };
    const pricing = new CheckoutOfferPricing(
        deps.catalog,
        deps.plans,
        deps.bundles,
        deps.promotions,
        deps.promoCodes,
    );
    const service = new CheckoutOfferService(
        deps.repo,
        pricing,
        deps.bundles,
        deps.plans,
        deps.catalogEntries,
        deps.contracts,
        deps.transactions,
    );
    return { service, ...deps };
}

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PromoCodesService } from '../dist/promo/index.js';

const TEST_CATALOG = {
    schemaVersion: 1,
    projectKey: 'test',
    currency: 'EUR',
    vatRate: 19,
    features: [],
    plans: [
        {
            id: 'BASIC',
            name: 'Basic',
            marketed: true,
            monthlyNet: 9.9,
            yearlyNet: 99,
            quotas: { users: 1 },
            features: [],
        },
        {
            id: 'STANDARD',
            name: 'Standard',
            marketed: true,
            monthlyNet: 24.9,
            yearlyNet: 249,
            quotas: { users: 1 },
            features: [],
        },
        {
            id: 'PROFESSIONAL',
            name: 'Professional',
            marketed: true,
            monthlyNet: 49.9,
            yearlyNet: 499,
            quotas: { users: 3 },
            features: [],
        },
        {
            id: 'ENTERPRISE',
            name: 'Enterprise',
            marketed: false,
            monthlyNet: 0,
            yearlyNet: 0,
            quotas: { users: -1 },
            features: [],
        },
    ],
};

const BASE_INPUT = {
    code: 'BLACKFRIDAY25',
    valueType: 'PERCENT',
    value: 25,
    durationType: 'BILLING_CYCLES',
    durationValue: 1,
    createdById: 'admin',
};

class FakePromoRepo {
    constructor() {
        this.byCode = new Map();
        this.byId = new Map();
        this.idSeq = 0;
    }
    async findById(id) {
        return this.byId.get(id) ?? null;
    }
    async findByCode(code) {
        return this.byCode.get(code) ?? null;
    }
    async findMany() {
        return [...this.byId.values()];
    }
    async create(data) {
        const id = `p${++this.idSeq}`;
        const record = {
            id,
            code: data.code,
            valueType: data.valueType,
            value: String(data.value),
            durationType: data.durationType,
            durationValue: data.durationValue ?? null,
            validFrom: data.validFrom ?? null,
            validUntil: data.validUntil ?? null,
            maxRedemptions: data.maxRedemptions ?? null,
            redemptionsCount: 0,
            appliesToPlans: data.appliesToPlans ?? [],
            appliesToBilling: data.appliesToBilling ?? null,
            firstTimeCustomersOnly: data.firstTimeCustomersOnly ?? false,
            minimumPlanAmountGross:
                data.minimumPlanAmountGross != null ? String(data.minimumPlanAmountGross) : null,
            allowZeroInvoice: data.allowZeroInvoice ?? false,
            status: 'ACTIVE',
            description: data.description ?? null,
            campaignTag: data.campaignTag ?? null,
            revenueDeductionAccount: data.revenueDeductionAccount ?? null,
            createdById: data.createdById,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
        };
        this.byCode.set(data.code, record);
        this.byId.set(id, record);
        return record;
    }
    async update(id, data) {
        const cur = this.byId.get(id);
        const next = { ...cur, ...data };
        this.byId.set(id, next);
        this.byCode.set(next.code, next);
        return next;
    }
    async softDelete(id) {
        const cur = this.byId.get(id);
        cur.deletedAt = new Date();
    }
    async claimSlot() {
        return true;
    }
    async markExhaustedIfFull() {}
    async releaseSlot() {}
    async expireDueCodes() {
        return 0;
    }
}

const NOOP_REDEMPTION_REPO = {
    async findBySubscription() {
        return null;
    },
    async create(data) {
        return {
            ...data,
            id: 'r1',
            status: 'ACTIVE',
            redeemedAt: new Date(),
            reversedAt: null,
        };
    },
    async setReversed(id) {
        return { id, status: 'REVERSED' };
    },
    async countByPromoCode() {
        return 0;
    },
    async listByPromoCode() {
        return [];
    },
    async expireDueRedemptions() {
        return 0;
    },
};

const NOOP_VALIDATION_LOG_REPO = {
    logs: [],
    async log(args) {
        this.logs.push(args);
    },
    async countValid() {
        return 0;
    },
};

const NOOP_FIRST_TIME_CHECK = {
    async hasExistingCustomerForEmail() {
        return false;
    },
};

const NOOP_SUBSCRIPTION_LOOKUP = {
    async findById() {
        return null;
    },
};

const NOOP_REVENUE_AGGREGATOR = {
    async sumGrossForPromoCode() {
        return '0.00';
    },
};

const PASSTHROUGH_TX_RUNNER = {
    async run(fn) {
        return fn(undefined);
    },
};

function buildSvc(overrides = {}) {
    const promoRepo = overrides.promoRepo ?? new FakePromoRepo();
    return new PromoCodesService(
        promoRepo,
        overrides.redemptionRepo ?? NOOP_REDEMPTION_REPO,
        overrides.validationLogRepo ?? NOOP_VALIDATION_LOG_REPO,
        overrides.firstTimeCheck ?? NOOP_FIRST_TIME_CHECK,
        overrides.subscriptionLookup ?? NOOP_SUBSCRIPTION_LOOKUP,
        overrides.revenueAggregator ?? NOOP_REVENUE_AGGREGATOR,
        overrides.transactionRunner ?? PASSTHROUGH_TX_RUNNER,
        overrides.catalog ?? TEST_CATALOG,
        overrides.config ?? { nonRedeemablePlans: ['ENTERPRISE'] },
    );
}

describe('PromoCodesService.create — validation', () => {
    test('accepts a valid code', async () => {
        const svc = buildSvc();
        const created = await svc.create(BASE_INPUT);
        assert.equal(created.code, 'BLACKFRIDAY25');
    });

    test('rejects a code with an invalid pattern', async () => {
        const svc = buildSvc();
        await assert.rejects(svc.create({ ...BASE_INPUT, code: 'ab' }));
        await assert.rejects(svc.create({ ...BASE_INPUT, code: 'WITH SPACE' }));
    });

    test('PERCENT must be 0–100', async () => {
        const svc = buildSvc();
        await assert.rejects(svc.create({ ...BASE_INPUT, value: 0 }));
        await assert.rejects(svc.create({ ...BASE_INPUT, value: 101 }));
    });

    test('ABSOLUTE must be positive', async () => {
        const svc = buildSvc();
        await assert.rejects(svc.create({ ...BASE_INPUT, valueType: 'ABSOLUTE', value: 0 }));
    });

    test('ONCE must not have a durationValue', async () => {
        const svc = buildSvc();
        await assert.rejects(
            svc.create({
                ...BASE_INPUT,
                code: 'X-ONCE',
                durationType: 'ONCE',
                durationValue: 3,
            }),
        );
    });

    test('MONTHS / BILLING_CYCLES need 1–24 as durationValue', async () => {
        const svc = buildSvc();
        await assert.rejects(
            svc.create({ ...BASE_INPUT, durationType: 'MONTHS', durationValue: 0 }),
        );
        await assert.rejects(
            svc.create({ ...BASE_INPUT, durationType: 'MONTHS', durationValue: 25 }),
        );
        await assert.rejects(
            svc.create({ ...BASE_INPUT, durationType: 'BILLING_CYCLES', durationValue: null }),
        );
    });

    test('rejects the nonRedeemablePlans whitelist (ENTERPRISE)', async () => {
        const svc = buildSvc();
        await assert.rejects(svc.create({ ...BASE_INPUT, appliesToPlans: ['ENTERPRISE'] }));
    });

    test('rejects validUntil ≤ validFrom', async () => {
        const svc = buildSvc();
        await assert.rejects(
            svc.create({
                ...BASE_INPUT,
                validFrom: new Date('2026-01-01'),
                validUntil: new Date('2025-12-31'),
            }),
        );
    });

    test('rejects ABSOLUTE ≥ lowest plan gross without allowZeroInvoice', async () => {
        const svc = buildSvc();
        // BASIC monthly 9.9 net → gross ~11.78 → 12 is above it
        await assert.rejects(
            svc.create({
                ...BASE_INPUT,
                valueType: 'ABSOLUTE',
                value: 12,
                durationType: 'ONCE',
                durationValue: null,
            }),
        );
    });

    test('accepts an ABSOLUTE discount ≥ plan gross when allowZeroInvoice=true', async () => {
        const svc = buildSvc();
        const created = await svc.create({
            ...BASE_INPUT,
            code: 'FREE-BASIC',
            valueType: 'ABSOLUTE',
            value: 100,
            allowZeroInvoice: true,
            durationType: 'ONCE',
            durationValue: null,
        });
        assert.equal(created.allowZeroInvoice, true);
    });

    test('rejects a duplicate code', async () => {
        const svc = buildSvc();
        await svc.create(BASE_INPUT);
        await assert.rejects(svc.create(BASE_INPUT));
    });
});

describe('PromoCodesService.preview — eligibility', () => {
    test('NOT_FOUND when no code exists', async () => {
        const svc = buildSvc();
        const r = await svc.preview({
            code: 'GHOST',
            planId: 'STANDARD',
            billingCycle: 'MONTHLY',
        });
        assert.equal(r.valid, false);
        assert.equal(r.reason, 'NOT_FOUND');
    });

    test('PLAN_MISMATCH when the whitelist excludes the plan', async () => {
        const repo = new FakePromoRepo();
        const svc = buildSvc({ promoRepo: repo });
        await svc.create({ ...BASE_INPUT, appliesToPlans: ['PROFESSIONAL'] });
        const r = await svc.preview({
            code: 'BLACKFRIDAY25',
            planId: 'STANDARD',
            billingCycle: 'MONTHLY',
        });
        assert.equal(r.valid, false);
        assert.equal(r.reason, 'PLAN_MISMATCH');
    });

    test('PLAN_MISMATCH on nonRedeemable (ENTERPRISE)', async () => {
        const repo = new FakePromoRepo();
        const svc = buildSvc({ promoRepo: repo });
        await svc.create(BASE_INPUT);
        const r = await svc.preview({
            code: 'BLACKFRIDAY25',
            planId: 'ENTERPRISE',
            billingCycle: 'MONTHLY',
        });
        assert.equal(r.valid, false);
        assert.equal(r.reason, 'PLAN_MISMATCH');
    });

    test('NOT_FIRST_TIME_CUSTOMER with firstTimeCustomersOnly + an existing customer', async () => {
        const repo = new FakePromoRepo();
        const svc = buildSvc({
            promoRepo: repo,
            firstTimeCheck: {
                async hasExistingCustomerForEmail() {
                    return true;
                },
            },
        });
        await svc.create({ ...BASE_INPUT, firstTimeCustomersOnly: true });
        const r = await svc.preview({
            code: 'BLACKFRIDAY25',
            planId: 'STANDARD',
            billingCycle: 'MONTHLY',
            email: 'someone@known.com',
        });
        assert.equal(r.valid, false);
        assert.equal(r.reason, 'NOT_FIRST_TIME_CUSTOMER');
    });

    test('valid=true with price preview for PROFESSIONAL/YEARLY/25%', async () => {
        const repo = new FakePromoRepo();
        const svc = buildSvc({ promoRepo: repo });
        await svc.create(BASE_INPUT);
        const r = await svc.preview({
            code: 'BLACKFRIDAY25',
            planId: 'PROFESSIONAL',
            billingCycle: 'YEARLY',
        });
        assert.equal(r.valid, true);
        // 499 net + 19% VAT = 593.81 gross · 25% = 148.45
        assert.equal(r.price.originalGross, '593.81');
        assert.equal(r.price.discountGross, '148.45');
        assert.equal(r.price.discountedGross, '445.36');
    });
});

describe('PromoCodesService.redeem — eligibility', () => {
    const SUBSCRIPTION_LOOKUP = {
        async findById() {
            return {
                id: 'sub-1',
                tenantId: 'tenant-1',
                plan: 'STANDARD',
                billingCycle: 'MONTHLY',
                startedAt: null,
            };
        },
    };

    test('enforces firstTimeCustomersOnly also at the final redeem with email', async () => {
        const repo = new FakePromoRepo();
        const svc = buildSvc({
            promoRepo: repo,
            subscriptionLookup: SUBSCRIPTION_LOOKUP,
            firstTimeCheck: {
                async hasExistingCustomerForEmail(email) {
                    assert.equal(email, 'kunde@example.com');
                    return true;
                },
            },
        });
        await svc.create({ ...BASE_INPUT, firstTimeCustomersOnly: true });

        await assert.rejects(
            () =>
                svc.redeem({
                    code: 'BLACKFRIDAY25',
                    subscriptionId: 'sub-1',
                    tenantId: 'tenant-1',
                    email: 'kunde@example.com',
                }),
            /NOT_FIRST_TIME_CUSTOMER/,
        );
    });

    test('blocks firstTimeCustomersOnly at the final redeem without email, fail-closed', async () => {
        const repo = new FakePromoRepo();
        const svc = buildSvc({
            promoRepo: repo,
            subscriptionLookup: SUBSCRIPTION_LOOKUP,
        });
        await svc.create({ ...BASE_INPUT, firstTimeCustomersOnly: true });

        await assert.rejects(
            () =>
                svc.redeem({
                    code: 'BLACKFRIDAY25',
                    subscriptionId: 'sub-1',
                    tenantId: 'tenant-1',
                }),
            /NOT_FIRST_TIME_CUSTOMER/,
        );
    });

    test('lets firstTimeCustomersOnly be redeemed for a first-time customer', async () => {
        const repo = new FakePromoRepo();
        const svc = buildSvc({
            promoRepo: repo,
            subscriptionLookup: SUBSCRIPTION_LOOKUP,
        });
        await svc.create({ ...BASE_INPUT, firstTimeCustomersOnly: true });

        const redemption = await svc.redeem({
            code: 'BLACKFRIDAY25',
            subscriptionId: 'sub-1',
            tenantId: 'tenant-1',
            email: 'neu@example.com',
        });
        assert.equal(redemption.subscriptionId, 'sub-1');
        assert.equal(redemption.tenantId, 'tenant-1');
    });
});

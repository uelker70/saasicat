import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PromoCodesService } from '../dist/promo/index.js';

const TEST_CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
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

// @requirement SC-PROMO-001 — A code is redeemed at most once per subscription
// @requirement SC-PROMO-002 — A code with a redemption limit cannot be over-redeemed
// @requirement SC-PROMO-003 — A redemption limit can be raised, never lowered
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

// @requirement SC-PROMO-006 — A discount runs for at most 24 months or billing periods
// @requirement SC-PROMO-007 — A one-off discount carries no duration and applies to the first invoice only
// @requirement SC-PROMO-008 — An absolute discount stays below the lowest price it can apply to
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

// @requirement SC-PROMO-009 — A plan may be marked as not discountable
// @requirement SC-PROMO-010 — A code is for first-time customers unless the operator says otherwise
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

describe('a code that has been redeemed is kept', () => {
    // Deleting one would take the explanation of somebody's discount with it:
    // the redemptions point at the code, and a customer asking why they paid
    // what they paid has to be answerable. So the code is paused, not removed.

    // @requirement SC-PROMO-004 — A code that has been redeemed is never deleted; it is paused
    test('a soft delete is refused while a redemption points at it', async () => {
        const promoRepo = new FakePromoRepo();
        const svc = buildSvc({
            promoRepo,
            redemptionRepo: {
                ...NOOP_REDEMPTION_REPO,
                async countByPromoCode() {
                    return 1;
                },
            },
        });
        const created = await svc.create(BASE_INPUT);

        await assert.rejects(
            () => svc.softDelete(created.id),
            (error) => {
                assert.equal(error.response.code, 'PROMO_CODE_HAS_REDEMPTIONS');
                assert.equal(error.response.params.redemptions, 1);
                return true;
            },
        );
        assert.ok(!((await promoRepo.findById(created.id)).deletedAt instanceof Date));
    });

    // @requirement SC-PROMO-004 — A code that has been redeemed is never deleted; it is paused
    test('and pausing it instead is allowed', async () => {
        // The other half of the promise. Refusing the delete is only right if
        // there is something the operator can do instead.
        const promoRepo = new FakePromoRepo();
        const svc = buildSvc({
            promoRepo,
            redemptionRepo: {
                ...NOOP_REDEMPTION_REPO,
                async countByPromoCode() {
                    return 1;
                },
            },
        });
        const created = await svc.create(BASE_INPUT);

        await svc.update(created.id, { status: 'PAUSED' });
        const after = await promoRepo.findById(created.id);
        assert.equal(after.status, 'PAUSED');
        assert.ok(!(after.deletedAt instanceof Date));
    });

    test('a code nobody redeemed is deleted as asked', async () => {
        // The counter-check: a rule that refused every delete would pass both
        // assertions above and break the operator's ordinary case.
        const promoRepo = new FakePromoRepo();
        const svc = buildSvc({ promoRepo });
        const created = await svc.create(BASE_INPUT);

        await svc.softDelete(created.id);
        assert.ok((await promoRepo.findById(created.id)).deletedAt instanceof Date);
    });
});

describe('a redemption and its discount stand or fall together', () => {
    // Half of this leaves a customer with a discount nobody recorded, or a
    // record of one they never received — and both are found months later, by
    // somebody reading an invoice that does not add up.
    //
    // Two writes make the pair: the code gives up a slot, and the redemption is
    // written. They are atomic only if both run in the *same* transaction and a
    // failure in the second is allowed to reach the runner.

    const SUBSCRIPTION = {
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

    function txRunner() {
        const context = { marker: 'the-one-transaction' };
        return {
            context,
            rolledBack: false,
            async run(work) {
                try {
                    return await work(this.context);
                } catch (error) {
                    this.rolledBack = true;
                    throw error;
                }
            },
        };
    }

    function watchfulPromoRepo(base) {
        base.claimedWith = [];
        const claimSlot = base.claimSlot.bind(base);
        base.claimSlot = async function (id, tx) {
            base.claimedWith.push(tx);
            return claimSlot(id, tx);
        };
        return base;
    }

    // @requirement SC-PROMO-011 — Redeeming a code applies the discount and records the redemption, or does neither
    test('the slot and the record are claimed in one transaction', async () => {
        const runner = txRunner();
        const promoRepo = watchfulPromoRepo(new FakePromoRepo());
        const seen = [];
        const svc = buildSvc({
            promoRepo,
            transactionRunner: runner,
            subscriptionLookup: SUBSCRIPTION,
            redemptionRepo: {
                ...NOOP_REDEMPTION_REPO,
                async create(data, tx) {
                    seen.push(tx);
                    return { id: 'r1', ...data };
                },
            },
        });
        await svc.create(BASE_INPUT);

        await svc.redeem({ code: 'BLACKFRIDAY25', subscriptionId: 'sub-1', tenantId: 'tenant-1' });

        assert.deepEqual(
            promoRepo.claimedWith,
            [runner.context],
            'the slot was claimed outside it',
        );
        assert.deepEqual(seen, [runner.context], 'the record was written outside it');
    });

    // @requirement SC-PROMO-011 — Redeeming a code applies the discount and records the redemption, or does neither
    test('a record that cannot be written takes the slot back with it', async () => {
        const runner = txRunner();
        const svc = buildSvc({
            transactionRunner: runner,
            subscriptionLookup: SUBSCRIPTION,
            redemptionRepo: {
                ...NOOP_REDEMPTION_REPO,
                async create() {
                    throw new Error('the redemption could not be written');
                },
            },
        });
        await svc.create(BASE_INPUT);

        await assert.rejects(
            () =>
                svc.redeem({
                    code: 'BLACKFRIDAY25',
                    subscriptionId: 'sub-1',
                    tenantId: 'tenant-1',
                }),
            /the redemption could not be written/,
        );
        assert.equal(runner.rolledBack, true, 'the failure never reached the runner');
    });

    test('an ordinary redemption is not rolled back', async () => {
        // The counter-check: a service that rolled everything back would pass
        // the case above and record nothing at all.
        const runner = txRunner();
        const svc = buildSvc({
            transactionRunner: runner,
            subscriptionLookup: SUBSCRIPTION,
        });
        await svc.create(BASE_INPUT);

        await svc.redeem({ code: 'BLACKFRIDAY25', subscriptionId: 'sub-1', tenantId: 'tenant-1' });
        assert.equal(runner.rolledBack, false);
    });
});

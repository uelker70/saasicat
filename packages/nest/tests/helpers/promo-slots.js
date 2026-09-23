// Promo codes, their redemptions and the slots held for checkouts, in memory,
// with the counting the persistence contract holds both adapters to: a slot is
// free while redemptions and holds together stay below the limit, a hold ends
// once, and a hold handed over on a transaction is converted by a redemption on
// that transaction and no other. What the adapters do against PostgreSQL is
// the contract's; these stores let a test ask what the platform does with it.

import assert from 'node:assert/strict';

import { givenPlanCatalogSource } from '../../dist/billing/index.js';
import { PromoCodesService } from '../../dist/promo/index.js';

import { RollbackRunner } from './payments.js';

/**
 * Four plans at 19 % VAT: BASIC at 9.90 net a month (11.78 gross), STANDARD at
 * 24.90 (29.63), PROFESSIONAL at 49.90, and ENTERPRISE, which is not marketed.
 */
export const PROMO_CATALOG = {
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

/** The gross monthly prices of BASIC and STANDARD. */
export const BASIC_GROSS = 11.78;
export const STANDARD_GROSS = 29.63;

export class MemoryPromoCodes {
    constructor() {
        this.codes = new Map();
        this.heldBy = new Map();
        this.seq = 0;
        this.holdRepository = holdRepositoryOver(this);
    }

    /** A code as an operator would have created it; `terms` override the defaults. */
    add(terms = {}) {
        const id = `promo-${++this.seq}`;
        const record = {
            id,
            code: 'LAST-SLOT',
            valueType: 'PERCENT',
            value: '10.00',
            durationType: 'ONCE',
            durationValue: null,
            validFrom: null,
            validUntil: null,
            maxRedemptions: null,
            redemptionsCount: 0,
            heldCount: 0,
            appliesToPlans: [],
            appliesToBilling: null,
            firstTimeCustomersOnly: false,
            minimumPlanAmountGross: null,
            allowZeroInvoice: false,
            status: 'ACTIVE',
            description: null,
            campaignTag: null,
            revenueDeductionAccount: null,
            createdById: 'operator',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            ...terms,
        };
        this.codes.set(id, record);
        return record;
    }

    /** For a transaction runner that puts the rows back on a rollback. */
    snapshot() {
        return {
            codes: new Map([...this.codes].map(([id, row]) => [id, { ...row }])),
            heldBy: new Map([...this.heldBy].map(([offer, hold]) => [offer, { ...hold }])),
        };
    }

    restore({ codes, heldBy }) {
        this.codes = codes;
        this.heldBy = heldBy;
    }

    async findById(id) {
        const row = this.codes.get(id);
        return row ? { ...row } : null;
    }

    async findByCode(code) {
        const row = [...this.codes.values()].find((c) => c.code === code.trim().toUpperCase());
        return row && !row.deletedAt ? { ...row } : null;
    }

    async findMany() {
        return [...this.codes.values()].filter((c) => !c.deletedAt).map((c) => ({ ...c }));
    }

    async create(data) {
        return this.add({
            ...data,
            value: String(data.value),
            minimumPlanAmountGross:
                data.minimumPlanAmountGross == null ? null : String(data.minimumPlanAmountGross),
        });
    }

    async update(id, data) {
        const row = this.codes.get(id);
        const defined = Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
        );
        Object.assign(row, defined, {
            ...(data.value !== undefined ? { value: String(data.value) } : {}),
            updatedAt: new Date(),
        });
        return { ...row };
    }

    async softDelete(id) {
        this.codes.get(id).deletedAt = new Date();
    }

    async claimSlot(id) {
        const row = this.codes.get(id);
        if (!row || row.status !== 'ACTIVE' || row.deletedAt || !hasFreeSlot(row)) return false;
        row.redemptionsCount += 1;
        return true;
    }

    async markExhaustedIfFull(id) {
        const row = this.codes.get(id);
        if (
            row.status === 'ACTIVE' &&
            row.maxRedemptions != null &&
            row.redemptionsCount >= row.maxRedemptions
        ) {
            row.status = 'EXHAUSTED';
        }
    }

    async releaseSlot(id) {
        const row = this.codes.get(id);
        row.redemptionsCount = Math.max(row.redemptionsCount - 1, 0);
        if (row.status === 'EXHAUSTED') row.status = 'ACTIVE';
    }

    async expireDueCodes(now) {
        let expired = 0;
        for (const row of this.codes.values()) {
            if (
                ['ACTIVE', 'PAUSED'].includes(row.status) &&
                row.validUntil &&
                row.validUntil < now
            ) {
                row.status = 'EXPIRED';
                expired += 1;
            }
        }
        return expired;
    }

    /** Ends a hold and moves its slot: back to the code, or to its redemptions. */
    endHold(checkoutOfferId, { redeemed }) {
        const hold = this.heldBy.get(checkoutOfferId);
        this.heldBy.delete(checkoutOfferId);
        const row = this.codes.get(hold.promoCodeId);
        row.heldCount = Math.max(row.heldCount - 1, 0);
        if (redeemed) row.redemptionsCount += 1;
    }
}

function hasFreeSlot(row) {
    return row.maxRedemptions == null || row.redemptionsCount + row.heldCount < row.maxRedemptions;
}

function holdRepositoryOver(store) {
    const view = (hold) => ({
        id: hold.id,
        promoCodeId: hold.promoCodeId,
        checkoutOfferId: hold.checkoutOfferId,
        expiresAt: hold.expiresAt,
        createdAt: hold.createdAt,
    });
    return {
        async findByCheckoutOffer(checkoutOfferId) {
            const hold = store.heldBy.get(checkoutOfferId);
            return hold ? view(hold) : null;
        },
        async take({ promoCodeId, checkoutOfferId, expiresAt }) {
            if (store.heldBy.has(checkoutOfferId)) return { outcome: 'offer-holds-one' };
            const row = store.codes.get(promoCodeId);
            if (!row || row.status !== 'ACTIVE' || row.deletedAt || !hasFreeSlot(row)) {
                return { outcome: 'no-slot' };
            }
            row.heldCount += 1;
            const hold = {
                id: `hold-${checkoutOfferId}`,
                promoCodeId,
                checkoutOfferId,
                expiresAt,
                createdAt: new Date(),
                handedOverTx: null,
            };
            store.heldBy.set(checkoutOfferId, hold);
            return { outcome: 'taken', hold: view(hold) };
        },
        async extend(checkoutOfferId, promoCodeId, expiresAt) {
            const hold = store.heldBy.get(checkoutOfferId);
            if (!hold || hold.promoCodeId !== promoCodeId) return false;
            hold.expiresAt = expiresAt;
            return true;
        },
        async release(checkoutOfferId) {
            if (!store.heldBy.has(checkoutOfferId)) return false;
            store.endHold(checkoutOfferId, { redeemed: false });
            return true;
        },
        async handOver(checkoutOfferId, now, tx) {
            const hold = store.heldBy.get(checkoutOfferId);
            if (!hold || hold.expiresAt <= now) return false;
            hold.handedOverTx = tx;
            return true;
        },
        async convertHandedOver(promoCodeId, tx) {
            const hold = [...store.heldBy.values()].find(
                (h) => h.promoCodeId === promoCodeId && h.handedOverTx === tx,
            );
            if (!hold) return false;
            store.endHold(hold.checkoutOfferId, { redeemed: true });
            return true;
        },
        async expireDue(now, promoCodeId, tx) {
            const due = [...store.heldBy.values()].filter(
                (h) =>
                    h.expiresAt <= now &&
                    h.handedOverTx !== tx &&
                    (promoCodeId === undefined || h.promoCodeId === promoCodeId),
            );
            for (const hold of due) store.endHold(hold.checkoutOfferId, { redeemed: false });
            return due.length;
        },
    };
}

/** Redemptions in memory, one per subscription as the unique index has it. */
export class MemoryRedemptions {
    constructor() {
        this.rows = [];
    }

    snapshot() {
        return this.rows.map((row) => ({ ...row }));
    }

    restore(rows) {
        this.rows = rows;
    }

    async findBySubscription(subscriptionId) {
        return this.rows.find((row) => row.subscriptionId === subscriptionId) ?? null;
    }

    async create(data) {
        if (this.rows.some((row) => row.subscriptionId === data.subscriptionId)) {
            throw new Error(`subscription ${data.subscriptionId} redeemed a code already`);
        }
        const row = {
            ...data,
            id: `redemption-${this.rows.length + 1}`,
            status: 'ACTIVE',
            redeemedAt: new Date(),
            reversedAt: null,
        };
        this.rows.push(row);
        return { ...row };
    }

    async setReversed(id) {
        const row = this.rows.find((r) => r.id === id);
        row.status = 'REVERSED';
        return { ...row };
    }

    async countByPromoCode(promoCodeId, status) {
        return this.rows.filter(
            (row) => row.promoCodeId === promoCodeId && (!status || row.status === status),
        ).length;
    }

    async listByPromoCode(promoCodeId) {
        return this.rows.filter((row) => row.promoCodeId === promoCodeId);
    }

    async expireDueRedemptions() {
        return 0;
    }
}

/** Subscriptions a redemption is checked against, added as a test creates them. */
export class MemorySubscriptions {
    constructor() {
        this.rows = new Map();
    }

    add(subscription) {
        this.rows.set(subscription.id, {
            plan: 'STANDARD',
            billingCycle: 'MONTHLY',
            startedAt: null,
            ...subscription,
        });
    }

    async findById(id) {
        return this.rows.get(id) ?? null;
    }
}

/**
 * A promo service over the stores; `holds: false` wires none, as an adapter
 * without a hold repository would.
 */
export function promoCodesOver({
    codes = new MemoryPromoCodes(),
    redemptions = new MemoryRedemptions(),
    subscriptions = new MemorySubscriptions(),
    transactions = new RollbackRunner([codes, redemptions]),
    existingCustomers = [],
    catalog = PROMO_CATALOG,
    holds = true,
} = {}) {
    const service = new PromoCodesService(
        codes,
        redemptions,
        { log: async () => {}, countValid: async () => 0 },
        { hasExistingCustomerForEmail: async (email) => existingCustomers.includes(email) },
        subscriptions,
        { sumGrossForPromoCode: async () => '0.00' },
        transactions,
        givenPlanCatalogSource(catalog),
        { nonRedeemablePlans: [] },
        holds ? codes.holdRepository : null,
    );
    return { service, codes, redemptions, subscriptions, transactions };
}

/** A moment `days` from now; negative for the past. */
export function inDays(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Asserts a refusal by its code and, where given, its reason. */
export function refusedWith(code, reason) {
    return (error) => {
        const body = error.getResponse?.() ?? error.response;
        assert.equal(body?.code, code, error.message);
        if (reason !== undefined) assert.equal(body?.params?.reason, reason, error.message);
        return true;
    };
}

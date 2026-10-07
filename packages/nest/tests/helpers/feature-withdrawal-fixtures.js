// The parts behind a feature withdrawal, kept in memory: the catalogue, the
// plan and add-on versions, the subscriptions bound to them, their bookings and
// contracts, where withdrawals and notices are kept, and the application's
// notice port — so a test can read what was announced, recorded and sent.

import { FeatureWithdrawalService, givenPlanCatalogSource } from '../../dist/billing/index.js';
import { usageRecord } from './subscription-fixtures.js';
import { noticeRecord, sendingPort } from './version-notices.js';

export const NOW = new Date('2026-06-15T10:00:00.000Z');
export const ACTOR = {
    userId: 'op-1',
    email: 'ops@example.com',
    source: 'web',
    context: 'admin',
};

export const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Demo App' },
    currency: 'EUR',
    vatRate: 19,
    features: [
        { key: 'EXPORT', label: 'Data export' },
        { key: 'REPORTS', label: 'Reports' },
    ],
    plans: [
        { id: 'PRO', name: 'Pro', features: ['EXPORT', 'REPORTS'], quotas: {}, monthlyNet: 49 },
        { id: 'BASIC', name: 'Basic', features: ['REPORTS'], quotas: {}, monthlyNet: 19 },
    ],
};

/** A published plan version, priced 49 a month and 490 a year unless said. */
export function planVersion(id, fields = {}) {
    return {
        id,
        planId: 'PRO',
        version: 1,
        features: ['EXPORT', 'REPORTS'],
        quotas: {},
        monthlyNet: '49.00',
        yearlyNet: '490.00',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...fields,
    };
}

/** A published add-on version granting the feature, priced 10 a month unless said. */
export function addOnVersion(id, fields = {}) {
    return {
        id,
        bundleId: 'b-export',
        bundleKey: 'EXPORT_PLUS',
        label: 'Export plus',
        version: 1,
        features: ['EXPORT'],
        quotas: {},
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: '10.00',
        yearlyNet: '100.00',
        marketed: true,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...fields,
    };
}

/** The subscription of `tenantId`, monthly on Pro v1, unless said. */
export function subscriptionOf(tenantId, overrides = {}) {
    return {
        tenantId,
        subscription: usageRecord({
            id: `sub-${tenantId}`,
            plan: 'PRO',
            billingCycle: 'MONTHLY',
            currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
            planVersion: { id: 'pv-pro-1', planId: 'PRO', version: 1 },
            ...overrides,
        }),
    };
}

/** A running booking of the add-on version `bundleVersionId` on the subscription of `tenantId`. */
export function bookingOf(tenantId, overrides = {}) {
    return {
        id: `sb-${tenantId}`,
        subscriptionId: `sub-${tenantId}`,
        bundleVersionId: 'bv-export-1',
        startedAt: new Date('2026-02-01T00:00:00.000Z'),
        minimumTermEndsAt: null,
        billingCycle: null,
        currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
        canceledAt: null,
        canceledEffectiveAt: null,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
        ...overrides,
    };
}

/** A contract in force of `tenantId` since 1 January, with the lines and snapshot given. */
export function contractOf(tenantId, { lineItems, features }) {
    return {
        id: `contract-${tenantId}`,
        tenantId,
        status: 'active',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveUntil: null,
        entitlementSnapshot: { plan: 'PRO', quotas: {}, features },
        lineItems,
    };
}

/** A contract's plan line, priced 49 a month and granting what is said. */
export function planLine(fields = {}) {
    return {
        id: 'line-plan',
        kind: 'plan',
        sourceKey: 'PRO',
        sourceVersionId: 'pv-pro-1',
        titleSnapshot: 'Pro',
        priceNet: 49,
        billingCycle: 'monthly',
        featuresSnapshot: ['EXPORT', 'REPORTS'],
        metadata: null,
        ...fields,
    };
}

/** Withdrawals kept in memory, a feature held to one not lifted as the database holds it. */
export function withdrawalStore(initial = []) {
    let rows = [...initial];
    const store = {
        get rows() {
            return rows;
        },
        createdIn: [],
        async create(data, tx) {
            store.createdIn.push(tx);
            if (rows.some((row) => row.featureKey === data.featureKey && row.liftedFrom === null)) {
                return null;
            }
            const row = {
                id: `fw-${rows.length + 1}`,
                ...structuredClone(data),
                liftedFrom: null,
                liftedAt: null,
                liftedBy: null,
            };
            rows = [...rows, row];
            return structuredClone(row);
        },
        async list() {
            return structuredClone([...rows].sort((a, b) => b.announcedAt - a.announcedAt));
        },
        async findById(id) {
            const row = rows.find((candidate) => candidate.id === id);
            return row ? structuredClone(row) : null;
        },
        async lift(id, lift) {
            const row = rows.find((candidate) => candidate.id === id);
            if (!row || row.liftedFrom !== null) return null;
            Object.assign(row, structuredClone(lift));
            return structuredClone(row);
        },
        snapshot: () => structuredClone(rows),
        restore: (saved) => {
            rows = saved;
        },
    };
    return store;
}

/** A withdrawal record as the store holds it. */
export function withdrawalRecord(fields = {}) {
    return {
        id: 'fw-existing',
        featureKey: 'EXPORT',
        reason: 'The export service has been switched off.',
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        liftedFrom: null,
        reductions: [],
        announcedAt: new Date('2026-05-30T00:00:00.000Z'),
        announcedBy: 'super-admin:ops@example.com',
        liftedAt: null,
        liftedBy: null,
        ...fields,
    };
}

/** The service over what is given, every part kept in memory. */
export function withdrawing({
    subscriptions = [subscriptionOf('t1')],
    planVersions = [planVersion('pv-pro-1')],
    addOnVersions = [addOnVersion('bv-export-1')],
    bookings = [],
    contracts = [],
    withdrawals = withdrawalStore(),
    notices = noticeRecord(),
    port = sendingPort(),
    replaces = {},
    usage: usageOverrides = {},
    bookingStore: bookingOverrides = {},
    withBookings = true,
    contractReductions = null,
} = {}) {
    const audited = [];
    let invalidations = 0;
    const tx = { transaction: 'tx-1' };
    const usage = {
        async listBoundToVersion(versionId) {
            return subscriptions.filter((row) => row.subscription.planVersion.id === versionId);
        },
        async listByIds(ids) {
            return subscriptions.filter(({ subscription }) => ids.includes(subscription.id));
        },
        async findForTenant(tenantId) {
            return subscriptions.find((row) => row.tenantId === tenantId)?.subscription ?? null;
        },
        ...usageOverrides,
    };
    const plans = {
        async list() {
            return [...new Set(planVersions.map((version) => version.planId))].map((planKey) => ({
                planKey,
            }));
        },
        async listVersions(planKey) {
            return planVersions.filter((version) => version.planId === planKey);
        },
    };
    const bundles = {
        async list() {
            return [...new Set(addOnVersions.map((version) => version.bundleId))].map((id) => ({
                id,
            }));
        },
        async listVersions(bundleId) {
            return addOnVersions.filter((version) => version.bundleId === bundleId);
        },
    };
    const bookingRepository = {
        async listOfVersion(bundleVersionId) {
            return bookings.filter((row) => row.bundleVersionId === bundleVersionId);
        },
        ...bookingOverrides,
    };
    const transactions = {
        async run(work) {
            const saved = withdrawals.snapshot?.();
            const savedNotices = new Map(notices.rows);
            try {
                return await work(tx);
            } catch (error) {
                if (saved) withdrawals.restore(saved);
                notices.rows.clear();
                for (const [key, row] of savedNotices) notices.rows.set(key, row);
                throw error;
            }
        },
    };
    const entitlements = {
        withReplacements(features) {
            const granted = new Set(features);
            for (const [oldKey, successor] of Object.entries(replaces)) {
                if (granted.has(oldKey)) granted.add(successor);
            }
            return granted;
        },
        invalidateAll() {
            invalidations += 1;
        },
    };
    const service = new FeatureWithdrawalService(
        withdrawals,
        transactions,
        notices,
        port,
        usage,
        givenPlanCatalogSource(CATALOG),
        entitlements,
        plans,
        withBookings ? bundles : null,
        withBookings ? bookingRepository : null,
        { list: async () => contracts },
        null,
        { log: async (entry) => audited.push(entry) },
        contractReductions,
    );
    return {
        service,
        withdrawals,
        notices,
        port,
        audited,
        tx,
        get invalidations() {
            return invalidations;
        },
    };
}

/** The refusal a promise ends in, as the body its exception carries. */
export async function refusalOf(promise) {
    try {
        await promise;
    } catch (error) {
        return { status: error.getStatus?.(), ...error.getResponse?.() };
    }
    throw new Error('expected a refusal');
}

export const codesOf = (preview) => preview.blockers.map((blocker) => blocker.code);

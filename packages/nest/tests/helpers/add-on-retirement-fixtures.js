// The add-on retirement as the tests build it: two versions of one add-on,
// subscriptions and bookings kept in memory, and the service over them.

import assert from 'node:assert/strict';

import { BundleVersionRetirementService } from '../../dist/billing/index.js';
import { FakeBundleRepository } from '../../dist/testing/index.js';
import { usageRecord } from './subscription-fixtures.js';
import { noticeRecord, sendingPort } from './version-notices.js';

export const NOW = new Date('2026-10-15T09:00:00.000Z');
export const ACTOR = {
    userId: 'op-1',
    email: 'operator@example.com',
    source: 'web',
    context: 'admin',
};

/** An add-on version as the catalogue keeps it. */
export function addOnVersion(id, fields = {}) {
    return {
        id,
        bundleId: 'b-reports',
        bundleKey: 'REPORTS',
        label: 'Reports',
        version: 1,
        baseVersionId: null,
        features: ['REPORTS'],
        quotas: { reports: 10 },
        compatibility: {},
        pricingOverrides: [],
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        marketed: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
        publishedChanges: [],
        changeNote: '',
        nonRegressive: true,
        createdByUserId: null,
        publishedByUserId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...fields,
    };
}

/** Reports v1, whose sale ended on 30 September. */
export const RETIRED = addOnVersion('bv-1', { validUntil: '2026-09-30T00:00:00.000Z' });
/** Reports v2, on sale since 1 October, dearer, and cheaper again beside Pro. */
export const REPLACEMENT = addOnVersion('bv-2', {
    version: 2,
    monthlyNet: '12.90',
    yearlyNet: '129.00',
    validFrom: '2026-10-01T00:00:00.000Z',
    pricingOverrides: [{ planId: 'PRO', monthlyNet: '10.90', yearlyNet: '109.00' }],
});

/** The add-on catalogue over `versions`, each add-on live unless `deleted` names it. */
export function catalogueOf(versions, { deleted = [] } = {}) {
    const bundles = new FakeBundleRepository();
    for (const bundleId of new Set(versions.map((version) => version.bundleId))) {
        const first = versions.find((version) => version.bundleId === bundleId);
        bundles.seedBundle({
            id: bundleId,
            bundleKey: first.bundleKey,
            label: first.label,
            description: null,
            icon: null,
            sortOrder: 0,
            i18n: {},
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: deleted.includes(bundleId) ? '2026-09-01T00:00:00.000Z' : null,
        });
    }
    for (const version of versions) bundles.seedVersion(version);
    return bundles;
}

/** A yearly Standard subscription of `tenantId`, its year ending on 1 January. */
export function subscriptionOf(tenantId, overrides = {}) {
    return {
        tenantId,
        subscription: usageRecord({
            id: `sub-${tenantId}`,
            plan: 'STANDARD',
            billingCycle: 'YEARLY',
            currentPeriodStart: new Date('2026-01-01T00:00:00.000Z'),
            currentPeriodEnd: new Date('2027-01-01T00:00:00.000Z'),
            planVersion: { id: 'pv-standard-1', planId: 'STANDARD', version: 1 },
            ...overrides,
        }),
    };
}

/** A booking of `bundleVersionId` on the subscription of `tenantId`, monthly to 1 November unless said. */
export function bookingOf(tenantId, overrides = {}) {
    return {
        id: `sb-${tenantId}`,
        subscriptionId: `sub-${tenantId}`,
        bundleVersionId: RETIRED.id,
        startedAt: new Date('2026-03-01T00:00:00.000Z'),
        minimumTermEndsAt: null,
        billingCycle: 'MONTHLY',
        currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
        canceledAt: null,
        canceledEffectiveAt: null,
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
        ...overrides,
    };
}

/**
 * A notice record in which the subscription of t1 was told on 2 October 2025
 * that Standard v1 retires onto Pro on 1 January 2027 — the first end of its
 * yearly term three months after — before its bookings' date, 1 February.
 */
export async function toldOfAPlanRetirementOntoPro() {
    const notices = noticeRecord();
    const told = new Date('2025-10-02T09:00:00.000Z');
    await notices.record(
        [
            {
                tenantId: 't1',
                subscriptionId: 'sub-t1',
                kind: 'version-retired',
                subject: 'pv-standard-1',
                content: {
                    kind: 'version-retired',
                    subscriptionId: 'sub-t1',
                    retired: { planVersionId: 'pv-standard-1', planKey: 'STANDARD' },
                    replacement: { planVersionId: 'pv-pro-2', planKey: 'PRO' },
                    billingCycle: 'YEARLY',
                    effectiveAt: '2027-01-01T00:00:00.000Z',
                },
            },
        ],
        told,
    );
    for (const row of notices.rows.values()) {
        Object.assign(row, {
            deliveredAt: told,
            delivery: { recipients: ['admin@example.com'], channel: 'email' },
        });
    }
    return notices;
}

/** An announcement store kept in memory. */
export function announcementStore() {
    const rows = [];
    return {
        rows,
        createdIn: [],
        async create(data, tx) {
            this.createdIn.push(tx);
            const row = { id: `bundle-retirement-${rows.length + 1}`, ...data };
            rows.push(row);
            return row;
        },
        async list() {
            return [...rows].reverse();
        },
        async findById(id) {
            return rows.find((row) => row.id === id) ?? null;
        },
    };
}

/** The service over `subscriptions` and `bookings`, with every part kept in memory. */
export function retiring({
    subscriptions = [subscriptionOf('t1'), subscriptionOf('t2')],
    bookings = [bookingOf('t1'), bookingOf('t2')],
    versions = [RETIRED, REPLACEMENT],
    deleted = [],
    termsConfirmed = true,
    notices = noticeRecord(),
    port = sendingPort(),
} = {}) {
    const retirements = announcementStore();
    const audited = [];
    const rolledBack = [];
    const tx = { transaction: 'tx-1' };
    const bookingRepository = {
        rows: bookings,
        async listOfVersion(bundleVersionId) {
            return bookings.filter((row) => row.bundleVersionId === bundleVersionId);
        },
        async findById(id) {
            return bookings.find((row) => row.id === id) ?? null;
        },
        async moveToVersion(id, from, to) {
            const at = bookings.findIndex((row) => row.id === id && row.bundleVersionId === from);
            if (at === -1) return null;
            bookings[at] = { ...bookings[at], bundleVersionId: to };
            return bookings[at];
        },
    };
    const usage = {
        async listByIds(ids) {
            return subscriptions.filter(({ subscription }) => ids.includes(subscription.id));
        },
    };
    const transactions = {
        async run(work) {
            try {
                return await work(tx);
            } catch (error) {
                rolledBack.push(error);
                throw error;
            }
        },
    };
    const catalogue = catalogueOf(versions, { deleted });
    const service = new BundleVersionRetirementService(
        catalogue,
        bookingRepository,
        usage,
        notices,
        port,
        retirements,
        transactions,
        { tenantBilling: { orderlyRetirement: { termsConfirmed } } },
        null,
        { log: async (entry) => audited.push(entry) },
    );
    return {
        service,
        notices,
        port,
        retirements,
        audited,
        tx,
        rolledBack,
        bookingRepository,
        usage,
        catalogue,
    };
}

export const codesOf = (preview) => preview.blockers.map((blocker) => blocker.code);
export const bookingIdsOf = (rows) => rows.map((row) => row.subscriptionBundleId);

export async function rejection(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }
    assert.fail('expected a refusal');
}

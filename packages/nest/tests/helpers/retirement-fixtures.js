// A retirement as the tests of what follows from it set it up: the two
// versions, what the announcement told a subscription, the record that keeps
// it, and the subscription on the retired version with the usage port that
// reads it.

import { VersionRetirementService } from '../../dist/billing/index.js';
import { usageRecord } from './subscription-fixtures.js';
import { noticeRecord, sendingPort } from './version-notices.js';

export const ANNOUNCED = new Date('2026-03-15T09:00:00.000Z');
/** The date the subscribers were told: they continue on the replacement from 1 July. */
export const DATE = new Date('2026-07-01T00:00:00.000Z');

export const RETIRED_SIDE = {
    planKey: 'STANDARD',
    planVersionId: 'pv-1',
    version: 1,
    features: [],
    quotas: {},
    monthlyNet: 49,
    yearlyNet: 490,
    validUntil: '2026-03-01T00:00:00.000Z',
    endsAt: null,
};
/** Version 3 of another plan, dearer by three a month and thirty a year. */
export const REPLACEMENT_SIDE = {
    ...RETIRED_SIDE,
    planKey: 'PLUS',
    planVersionId: 'pv-9',
    version: 3,
    monthlyNet: 52,
    yearlyNet: 520,
    validUntil: null,
};

/** What the announcement told the subscription of `tenantId`. */
export function noticeFor(tenantId, overrides = {}) {
    return {
        kind: 'version-retired',
        tenantId,
        subscriptionId: `sub-${tenantId}`,
        retirementId: 'ret-1',
        retired: RETIRED_SIDE,
        replacement: REPLACEMENT_SIDE,
        changes: [],
        billingCycle: 'MONTHLY',
        effectiveAt: DATE.toISOString(),
        lastDayToCancel: '2026-06-30',
        ...overrides,
    };
}

/** A notice record holding what each announcement told. */
export async function told(...notices) {
    const record = noticeRecord();
    await record.record(
        notices.map((notice) => ({
            tenantId: notice.tenantId,
            subscriptionId: notice.subscriptionId,
            kind: notice.kind,
            subject: notice.retired.planVersionId,
            content: notice,
        })),
        ANNOUNCED,
    );
    return record;
}

/** A monthly subscription of `tenantId` on the retired version. */
export function subscriptionOf(tenantId, overrides = {}) {
    return usageRecord({
        id: `sub-${tenantId}`,
        plan: 'STANDARD',
        billingCycle: 'MONTHLY',
        currentPeriodStart: new Date('2026-06-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-07-01T00:00:00.000Z'),
        planVersion: { id: 'pv-1', planId: 'STANDARD', version: 1 },
        pendingChangeVersionId: null,
        ...overrides,
    });
}

export const tenantOf = (sub) => sub.id.slice('sub-'.length);

/** The usage port over `subs`, as the adapters answer it: each read a copy of the row. */
export function usageOver(subs) {
    return {
        async findForTenant(tenantId) {
            const sub = subs.find((candidate) => tenantOf(candidate) === tenantId);
            return sub ? { ...sub } : null;
        },
        async listBoundToVersion(planVersionId) {
            return subs
                .filter((sub) => sub.planVersion?.id === planVersionId)
                .map((sub) => ({ tenantId: tenantOf(sub), subscription: { ...sub } }));
        },
    };
}

/**
 * The retirement service over `subs` and the notices in `record`, with the one
 * announcement the notices name.
 */
export function retirementServiceOver({ subs, record }) {
    const retirements = {
        rows: [
            {
                id: 'ret-1',
                retired: { planVersionId: 'pv-1', planKey: 'STANDARD', version: 1 },
                replacement: { planVersionId: 'pv-9', planKey: 'PLUS', version: 3 },
                announcedAt: ANNOUNCED,
                announcedBy: 'web:operator@example.com:admin',
            },
        ],
        async list() {
            return this.rows;
        },
    };
    return new VersionRetirementService(
        { findVersionById: async () => null },
        usageOver(subs),
        record,
        sendingPort(),
        retirements,
        { run: async (work) => work({}) },
        { tenantBilling: { orderlyRetirement: { termsConfirmed: true } } },
        null,
        null,
    );
}

// A running monthly subscription as `GET /billing/usage` answers it, with the
// days the server names beside each moment (`answeredUsage`). A case sets the
// fields it is about and leaves the rest as they are here.

import type { UsageSnapshotShape } from '@saasicat/ui-vue';

import { answeredUsage, type UsageAsRead } from './server-days.js';

/** A moment still to come, whose own date is no day any case names. */
export const AHEAD = '2099-06-15T12:00:00.000Z';

export function aRunningSubscription(fields: Partial<UsageAsRead> = {}): UsageSnapshotShape {
    return answeredUsage({
        plan: 'PRO',
        effectivePlan: 'PRO',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        currentPeriodStart: '2026-06-01T00:00:00.000Z',
        currentPeriodEnd: AHEAD,
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: {
            id: 'pv-1',
            planId: 'PRO',
            version: 1,
            publishedAt: '2026-01-01T00:00:00.000Z',
            supersededAt: null,
            changeNote: null,
        },
        planPriceNet: 29,
        limits: { plan: 'PRO', quotas: { users: 5 }, features: [] },
        usage: { users: 1 },
        packageSnapshot: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        cancellation: {
            effectiveAt: AHEAD,
            termEndsAt: AHEAD,
            noticeDeadline: null,
            afterNoticeDeadline: false,
        },
        retirement: null,
        retirementSwitch: null,
        checkoutOfferId: null,
        ...fields,
    });
}

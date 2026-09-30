// A subscription bound to version 1 of a monthly Standard plan, and the plan
// versions an offer is read from — for the tests of reading an offer and of
// taking one.

import { usageRecord } from './subscription-fixtures.js';

export const NOW = new Date('2026-10-15T09:00:00.000Z');
export const PERIOD_END = new Date('2027-01-01T00:00:00.000Z');

/** A plan version row as the repository returns it: Standard v1, 49 € a month. */
export function version(overrides = {}) {
    return {
        id: 'pv-1',
        planId: 'STANDARD',
        version: 1,
        features: ['DASHBOARD', 'EXPORT'],
        quotas: { users: 5, vehicles: 100 },
        monthlyNet: '49.00',
        yearlyNet: '490.00',
        marketed: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        supersededAt: null,
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
        endsAt: null,
        ...overrides,
    };
}

export const BOUND = version();

/** Version 2 of the same plan, differing where the test says. */
export const V2 = (overrides = {}) => version({ id: 'pv-2', version: 2, ...overrides });

export function subscription(overrides = {}) {
    return usageRecord({
        plan: 'STANDARD',
        billingCycle: 'MONTHLY',
        currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
        currentPeriodEnd: PERIOD_END,
        planVersion: { id: BOUND.id, planId: 'STANDARD', version: 1 },
        ...overrides,
    });
}

/** A repository without validity windows, holding `rows` and serving `live` as the newest. */
export function repositoryWith(rows, live) {
    return {
        findVersionById: async (id) => rows.find((row) => row.id === id) ?? null,
        findLatestLivePlanVersion: async (planKey) =>
            live && live.planId === planKey ? live : null,
    };
}

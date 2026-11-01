// The preview a plan change is answered with, as the server answers it: with
// the days of the moment it takes effect (`answered`).

import type { PlanChangePreviewShape, PlanSnapshotShape } from '@saasicat/ui-vue';

import { answered } from './server-days.js';

const plan = (id: string, name: string, monthlyNet: number, users: number): PlanSnapshotShape => ({
    id,
    name,
    monthlyNet,
    yearlyNet: monthlyNet * 10,
    quotas: { users },
    features: [],
});

/**
 * A yearly Basic subscriber choosing monthly Pro: the plan goes up, the period
 * gets shorter, and the shorter period defers the change to the end of the year.
 */
export const DEFERRED_UPGRADE: PlanChangePreviewShape = {
    changeType: 'UPGRADE',
    planDirection: 'UP',
    cycleDirection: 'SHORTER',
    current: { plan: plan('pl-1', 'Basic', 10, 5), billingCycle: 'YEARLY' },
    target: { plan: plan('pl-2', 'Pro', 20, 50), billingCycle: 'MONTHLY', planVersionId: null },
    isImmediate: false,
    ...answered({ effectiveAt: '2027-01-01T00:00:00.000Z', projectedTrialEndsAt: null }, [
        'effectiveAt',
        'projectedTrialEndsAt',
    ]),
    proration: null,
    limitsCheck: {},
    featuresGained: [],
    featuresLost: [],
    blockers: [],
    warnings: [],
};

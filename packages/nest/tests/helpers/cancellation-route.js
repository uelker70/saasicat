// The tenant's cancellation route over one running subscription, for a test
// about which notice a cancellation is owed.

import { TenantBillingController } from '../../dist/billing/index.js';

// Forty days of period left: a fourteen-day notice is served by it, a ninety-day
// one is not. Relative to now, because the controller reads the clock — a fixed
// date would decide a test by how long ago it was written.
const DAY = 24 * 60 * 60 * 1000;
const PERIOD_END = new Date(Date.now() + 40 * DAY);
const PERIOD_START = new Date(Date.now() - 10 * DAY);

/** A running subscription of tenant `t1` in `billingCycle`, forty days before its period ends. */
const subscription = (billingCycle) => ({
    plan: 'STARTER',
    billingCycle,
    status: 'ACTIVE',
    isPilot: false,
    pilotEndsAt: null,
    trialEndsAt: null,
    startedAt: PERIOD_START,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    minimumTermUntil: null,
    canceledAt: null,
    canceledEffectiveAt: null,
    billingAnchorDay: PERIOD_END.getUTCDate(),
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    planVersion: null,
});

/** The request of a user of tenant `t1`. */
export const CANCELLING = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

/**
 * The controller over that subscription, the file naming `notice`, and
 * `contracts` as the installation's contracts — `null` where it keeps none.
 * `port` records what the route writes.
 */
export function cancellationRoute({ billingCycle = 'MONTHLY', notice, contracts = null }) {
    const port = {
        calls: [],
        async cancelSubscription(_tenantId, input) {
            this.calls.push(input);
            return {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: 'ACTIVE',
            };
        },
    };
    const controller = new TenantBillingController(
        {
            computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
            invalidateTenant() {},
        },
        {
            async preview() {
                return { isImmediate: false, effectiveAt: null, blockers: [] };
            },
        },
        { findForTenant: async () => subscription(billingCycle) },
        { snapshot: async () => ({}) },
        port,
        () => 't1',
        () => 'u1',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        notice,
        null,
        undefined,
        undefined,
        null,
        null,
        contracts,
    );
    return { controller, port };
}

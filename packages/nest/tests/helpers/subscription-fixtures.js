// The shapes a subscription takes on its way through the platform, in one
// place.
//
// Three ports read a subscription and each wants it slightly differently: the
// entitlement path takes a `SubscriptionRecord` with a plan version attached,
// the tenant billing routes take a `SubscriptionUsageRecord` with the dates a
// page shows, and the preview takes the latter too. Written out per file, the
// three drifted — and a fixture that is subtly wrong is worse than a missing
// one, because the test still passes.

export const PRO = {
    id: 'PRO',
    name: 'Pro',
    tagline: '',
    marketed: true,
    monthlyNet: 49,
    yearlyNet: 490,
    quotas: { users: 50 },
    features: ['EXPORT'],
};

export const FREE = {
    id: 'FREE',
    name: 'Free',
    tagline: '',
    marketed: true,
    monthlyNet: 0,
    yearlyNet: 0,
    quotas: { users: 1 },
    features: ['READ_ONLY'],
};

export const CATALOG = {
    schemaVersion: 1,
    projectKey: 'demo',
    currency: 'EUR',
    vatRate: 19,
    plans: [PRO, FREE],
};

/** What `SubscriptionRepository.findByTenantId` answers — the entitlement path. */
export function subscriptionRecord(overrides = {}) {
    return {
        id: 's1',
        tenantId: 't1',
        plan: 'PRO',
        status: 'ACTIVE',
        isPilot: false,
        trialEntitlementPlan: null,
        pendingPlan: null,
        pendingEffectiveAt: null,
        customLimits: null,
        planVersionId: 'pv1',
        planVersion: { planId: 'PRO', quotas: PRO.quotas, features: PRO.features },
        canceledAt: null,
        canceledEffectiveAt: null,
        ...overrides,
    };
}

/** What `SubscriptionUsagePort.findForTenant` answers — the tenant routes. */
export function usageRecord(overrides = {}) {
    return {
        plan: 'STARTER',
        billingCycle: 'YEARLY',
        status: 'ACTIVE',
        isPilot: false,
        pilotEndsAt: null,
        trialEndsAt: null,
        startedAt: new Date('2026-01-01'),
        currentPeriodStart: new Date('2026-01-01'),
        currentPeriodEnd: null,
        minimumTermUntil: null,
        canceledAt: null,
        canceledEffectiveAt: null,
        pendingPlan: null,
        pendingBillingCycle: null,
        pendingEffectiveAt: null,
        planVersion: null,
        pendingPlanVersion: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
        ...overrides,
    };
}

/** An entitlement service over one subscription, with the catalog above. */
export function entitlementServiceFor(EntitlementService, subscription, options = {}) {
    const { config = null, contract = null, bundles = null } = options;
    return new EntitlementService(
        CATALOG,
        { findByTenantId: async () => subscription },
        {
            findActive: async (planId) => {
                const plan = CATALOG.plans.find((candidate) => candidate.id === planId);
                return plan ? { planId, quotas: plan.quotas, features: plan.features } : null;
            },
        },
        { run: async (fn) => fn(undefined) },
        config,
        bundles ? { listActiveBySubscription: async () => bundles } : null,
        bundles ? { findVersionById: async () => null } : null,
        contract ? { findActiveByTenantId: async () => contract } : null,
    );
}

/**
 * A write port that records what it was handed and claims every row.
 *
 * `claimed` is required of a real adapter, so a fake that omits it would send
 * every caller down the "somebody changed this underneath you" path.
 */
export function recordingWritePort() {
    return {
        immediate: [],
        scheduled: [],
        atomic: [],
        accepted: [],
        cancellations: [],
        async changePlanImmediate(tenantId, input) {
            this.immediate.push(input);
            return { plan: input.planId, billingCycle: input.cycle, claimed: true };
        },
        async schedulePlanChange(tenantId, input) {
            this.scheduled.push(input);
            return { claimed: true };
        },
        async applyOnboardingSelection(tenantId, input) {
            this.atomic.push(input);
            return {
                plan: input.planId,
                billingCycle: input.cycle,
                subscriptionId: 's1',
                promoRedemption: null,
                claimed: true,
            };
        },
        async acceptPendingPlanVersion(tenantId, userId) {
            this.accepted.push({ tenantId, userId });
            return { acceptedAt: new Date(), effectiveAt: null, alreadyAccepted: false };
        },
        async cancelSubscription(tenantId, input) {
            this.cancellations.push(input);
            return {
                canceledAt: input.canceledAt,
                canceledEffectiveAt: input.effectiveAt,
                status: input.terminateNow ? 'CANCELED' : 'ACTIVE',
                alreadyCanceled: false,
            };
        },
    };
}

/** The request shape the routes read a tenant and a user from. */
export const REQUEST = { user: { tenantId: 't1', sub: 'u1' }, headers: {} };

/** Entitlements that grant the STARTER plan and nothing else. */
export const FLAT_ENTITLEMENTS = {
    computeLimits: async () => ({ plan: 'STARTER', quotas: {}, features: new Set() }),
    invalidateTenant() {},
};

// DI tokens for the EntitlementService class (Slice B).
//
// Consumers register implementations via `EntitlementModule.forRoot`
// or directly as custom providers in the AppModule.

// The service itself needs a token too: other subpath bundles (billing's
// TenantBillingModule etc.) inject EntitlementService, and the CJS builds do
// not share the class instance across bundles — a bare class token would be two
// different objects. `Symbol.for` resolves both to the same token.
export const ENTITLEMENT_SERVICE_TOKEN = Symbol.for('saas-platform/EntitlementService');

export const SUBSCRIPTION_REPOSITORY_TOKEN = Symbol.for('saas-platform/SubscriptionRepository');
export const PLAN_VERSION_REPOSITORY_TOKEN = Symbol.for('saas-platform/PlanVersionRepository');
export const TRANSACTION_RUNNER_TOKEN = Symbol.for('saas-platform/TransactionRunner');
export const ENTITLEMENT_RESOLUTION_CONFIG_TOKEN = Symbol.for(
    'saas-platform/EntitlementResolutionConfig',
);

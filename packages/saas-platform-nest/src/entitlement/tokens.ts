// DI tokens for the EntitlementService class (Slice B).
//
// Consumers register implementations via `EntitlementModule.forRoot`
// or directly as custom providers in the AppModule.

export const SUBSCRIPTION_REPOSITORY_TOKEN = Symbol.for('saas-platform/SubscriptionRepository');
export const PLAN_VERSION_REPOSITORY_TOKEN = Symbol.for('saas-platform/PlanVersionRepository');
export const TRANSACTION_RUNNER_TOKEN = Symbol.for('saas-platform/TransactionRunner');
export const ENTITLEMENT_RESOLUTION_CONFIG_TOKEN = Symbol.for(
    'saas-platform/EntitlementResolutionConfig',
);

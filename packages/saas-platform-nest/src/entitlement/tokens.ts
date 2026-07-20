// DI-Tokens für die EntitlementService-Klasse (Slice B).
//
// Konsumenten registrieren Implementierungen über `EntitlementModule.forRoot`
// oder direkt als Custom-Provider im AppModule.

export const SUBSCRIPTION_REPOSITORY_TOKEN = Symbol.for('saas-platform/SubscriptionRepository');
export const PLAN_VERSION_REPOSITORY_TOKEN = Symbol.for('saas-platform/PlanVersionRepository');
export const TRANSACTION_RUNNER_TOKEN = Symbol.for('saas-platform/TransactionRunner');
export const ENTITLEMENT_RESOLUTION_CONFIG_TOKEN = Symbol.for(
    'saas-platform/EntitlementResolutionConfig',
);

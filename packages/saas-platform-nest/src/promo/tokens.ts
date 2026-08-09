// DI tokens for the promo-module adapters.
// Consumers inject their adapter implementations through these symbol tokens
// in `PromoCodesModule.forRoot({...})`.

export const PROMO_CODE_REPOSITORY_TOKEN = Symbol.for('saas-platform/PromoCodeRepository');
export const PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/PromoCodeRedemptionRepository',
);
export const PROMO_CODE_VALIDATION_LOG_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform/PromoCodeValidationLogRepository',
);
export const PROMO_FIRST_TIME_CUSTOMER_CHECK_TOKEN = Symbol.for(
    'saas-platform/PromoFirstTimeCustomerCheck',
);
export const PROMO_SUBSCRIPTION_LOOKUP_TOKEN = Symbol.for('saas-platform/PromoSubscriptionLookup');
export const PROMO_REVENUE_DEDUCTION_AGGREGATOR_TOKEN = Symbol.for(
    'saas-platform/PromoRevenueDeductionAggregator',
);
export const PROMO_TRANSACTION_RUNNER_TOKEN = Symbol.for('saas-platform/PromoTransactionRunner');
export const PROMO_SERVICE_CONFIG_TOKEN = Symbol.for('saas-platform/PromoServiceConfig');

// @saasicat/nest/entitlement — Sub-Entry für Limit-Aggregation.
//
// Slice A (P1.5, Phase 19): Pure-Function-Aggregation über Snapshot-Form.
//   - types:           PlanVersionSnapshot, SubscriptionLimitsInput,
//                      CustomLimitsShape, EffectiveLimits, EffectiveLimitsSnapshot
//   - aggregation:     aggregateLimits, filterActiveSubscriptionBundles,
//                      aggregateSubscriptionBundleQuotas, applyCustomLimits,
//                      filterPlannedOnlyFeatures, hasFeature, hasAnyFeature,
//                      toEffectiveLimitsSnapshot
//   - plan-resolution: resolveEntitlementPlan + EntitlementResolutionConfig
//   - error:           LimitExceededError
//
// Slice B (P1.5/P1.8/P1.9, Phase 21): EntitlementService-Klasse mit DI,
// LRU-Cache, Repository-Ports, transactional `enforceLimit`.
//   - service:         EntitlementService + EnforceLimitInput
//   - module:          EntitlementModule.forRoot({ subscriptionRepository,
//                      planVersionRepository, transactionRunner, … })
//   - tokens:          SUBSCRIPTION_REPOSITORY_TOKEN,
//                      PLAN_VERSION_REPOSITORY_TOKEN,
//                      TRANSACTION_RUNNER_TOKEN,
//                      ENTITLEMENT_RESOLUTION_CONFIG_TOKEN

export * from './types.js';
export * from './aggregation.js';
export * from './feature-aliases.js';
export * from './plan-resolution.js';
export * from './limit-exceeded-error.js';
export * from './service.js';
export * from './module.js';
export * from './tokens.js';

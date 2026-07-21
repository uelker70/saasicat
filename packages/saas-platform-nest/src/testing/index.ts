// @saasicat/nest/testing — test utilities.
//
// Fake adapters for the repository ports + TransactionRunner. For unit tests
// in the platform package and in consumers without a DB requirement.

export * from './fake-repositories.js';
export * from './create-saas-platform-test-module.js';

// Re-exported ON PURPOSE from this entry: the tsup multi-entry build
// duplicates classes per sub-bundle, so `moduleRef.get(X)` only finds X when
// the test imports it from the SAME entry that built the module. Tests using
// `createSaasPlatformTestModule` must resolve these via
// `@saasicat/nest/testing`, not `@saasicat/nest/platform`.
export { StaticEntitlementService } from '../platform/static-entitlement.service.js';
export { StaticFeatureGuard } from '../platform/static-feature.guard.js';
export { EnforceQuotaInterceptor } from '../platform/enforce-quota.interceptor.js';
export { PLAN_RESOLVER_PORT_TOKEN, StaticPlanResolver } from '../platform/plan-resolver.port.js';

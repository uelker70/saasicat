// @saasicat/nest — top-level exports.
//
// Sub-entries (see package.json exports):
//   ./promo        — promo-code calculator + math helpers
//   ./billing      — billing-period math, version-diff classification,
//                    RequireFeature decorator, PlanCatalogModule, plan-helpers,
//                    version-publish (pure-function validation),
//                    version-renewal (pure-function math)
//   ./entitlement  — aggregateLimits, resolveEntitlementPlan,
//                    LimitExceededError, EntitlementService, EntitlementModule
//   ./admin        — SuperAdminGuard, MfaGuard, RequireMfa, MfaService,
//                    AdminAuditService, AdminBypassRlsInterceptor, AdminModule
//   ./registration — PendingRegistrationService, RegistrationModule, OTP/slug helpers
//                    for the multi-step registration flow.
//   ./discovery    — @ImplementsCapability/@RequiresCapability/@DefinesQuota/
//                    @EnforceQuota decorators, DiscoveryScanner, DiscoveryModule
//                    (see SPEC_V2.md §3)
//   ./catalog      — BundlesService + Controller + Module for Bundle/BundleVersion
//                    CRUD in SuperAdmin (SPEC_V2.md §11.1 M3)
//   ./checkout-offer — CheckoutOfferModule/Service for package snapshots
//   ./subscription-contract — immutable SubscriptionContract service for V3
//   ./testing      — fake adapters (FakeSubscriptionRepository, …) for tests

export * from './core/di.js';
export * from './promo/index.js';
export * from './billing/index.js';
export * from './entitlement/index.js';
export * from './admin/index.js';
export * from './setup/index.js';
export * from './registration/index.js';
export * from './discovery/index.js';
export * from './catalog/index.js';
export * from './checkout-offer/index.js';
export * from './subscription-contract/index.js';

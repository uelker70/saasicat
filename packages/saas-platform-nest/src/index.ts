// @saasicat/nest — Top-Level-Exports.
//
// Sub-Entries (siehe package.json exports):
//   ./promo        — Promo-Code-Calculator + Math-Helpers
//   ./billing      — Billing-Period-Math, Version-Diff-Klassifikation,
//                    RequireFeature-Decorator, PlanCatalogModule, plan-helpers,
//                    version-publish (Pure-Function-Validierung),
//                    version-renewal (Pure-Function-Math)
//   ./entitlement  — aggregateLimits, resolveEntitlementPlan,
//                    LimitExceededError, EntitlementService, EntitlementModule
//   ./admin        — SuperAdminGuard, MfaGuard, RequireMfa, MfaService,
//                    AdminAuditService, AdminBypassRlsInterceptor, AdminModule
//   ./registration — PendingRegistrationService, RegistrationModule, OTP/Slug-Helpers
//                    fuer den mehrstufigen Registrierungs-Flow.
//   ./discovery    — @ImplementsCapability/@RequiresCapability/@DefinesQuota/
//                    @EnforceQuota Decorators, DiscoveryScanner, DiscoveryModule
//                    (siehe SPEC_V2.md §3)
//   ./catalog      — BundlesService + Controller + Module für Bundle/BundleVersion-
//                    CRUD im SuperAdmin (SPEC_V2.md §11.1 M3)
//   ./checkout-offer — CheckoutOfferModule/Service fuer Paket-Snapshots
//   ./subscription-contract — immutable SubscriptionContract-Service fuer V3
//   ./testing      — Fake-Adapter (FakeSubscriptionRepository, …) für Tests

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

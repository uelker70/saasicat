// @saasicat/nest/billing — Sub-Entry für Billing-Logik.
//
// Aktuell (P1-Slice):
//   - billing-period:    periodEndAfter, initialPeriodWindow, periodEndWithMinLead
//   - version-diff:      classifyPlanDiff, classifyBundleVersionDiff
//   - require-feature:   @RequireFeature(...keys) Decorator + REQUIRE_FEATURE_KEY
//   - plan-catalog-loader: loadPlanCatalogFromFile() / loadPlanCatalogFromString()
//   - PlanCatalogModule: NestJS-Modul mit forRoot({ path }) + PLAN_CATALOG_TOKEN
//   - plan-helpers:      findPlan, getPlanOrThrow, getMarketedPlans,
//                        getPlanPriceNet/Gross, getPlanQuota,
//                        isFeatureInPlan, isFeaturePlannedOnly
//
// Folge-Phasen ergänzen: PlanVersionsService, Plan-Version-Renewal/
// Notification-Cron, TrialExpirationService.

export * from './billing-period.js';
export * from './version-diff.js';
export * from './version-publish.js';
export * from './version-renewal.js';
export * from './require-feature.decorator.js';
export * from './feature-guard.tokens.js';
export * from './feature.guard.js';
export * from './upsell.tokens.js';
export * from './catalog-bundle-upsell-resolver.js';
export * from './limit-exceeded.filter.js';
export * from './plan-catalog-loader.js';
export * from './plan-catalog.module.js';
export {
    buildPlanCatalogFromSnapshot,
    type PlanCatalogBuildSettings,
} from './plan-catalog-from-snapshot.js';
export {
    PLAN_CATALOG_IMPORT_SINK_TOKEN,
    PlanCatalogImporterService,
} from './plan-catalog-importer.service.js';
export {
    PlanCatalogImporterModule,
    type PlanCatalogImporterModuleOptions,
    type PlanCatalogImporterControllerConfig,
} from './plan-catalog-importer.module.js';
export {
    buildPlanCatalogImporterController,
    PlanCatalogImportDto,
} from './plan-catalog-importer.controller.js';
export * from './plan-helpers.js';
export * from './feature-ui-registry.tokens.js';
export * from './public-catalog.controller.js';
export * from './public-catalog.module.js';
export {
    PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_PROJECT_KEY_TOKEN,
} from './public-catalog.tokens.js';
export * from './tenant-billing.tokens.js';
export * from './composed-tenant-auth.guard.js';
export * from './tenant-admin.guard.js';
export * from './self-service-policy.js';
export * from './proration.js';
export * from './plan-change-preview.service.js';
export * from './pending-plan-materialization.service.js';
export * from './contract-freeze.tokens.js';
export * from './subscription-contract-freeze.service.js';
export * from './trial-carryover.js';
export * from './dto/tenant-billing.dto.js';
export * from './dto/onboarding-subscription.dto.js';
export * from './tenant-billing.controller.js';
export * from './tenant-billing.module.js';
export * from './configurator-catalog-builder.js';
export * from './subscription-bundles.tokens.js';
export * from './subscription-bundles.service.js';
export * from './subscription-bundle-preview.service.js';
export * from './subscription-bundles.module.js';
export * from './tenant-subscription-bundles.controller.js';

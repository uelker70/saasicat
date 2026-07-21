// @saasicat/nest/catalog — Bundle/BusinessType/Marketing editor
// for SuperAdmin (SPEC_V2 §11.1 M3).
//
// Included in M3.1:
//   - BundlesService (CRUD for Bundle + BundleVersion with strict-mode check)
//   - BundlesController + BundleVersionsController (REST under /admin/catalog/...)
//   - CatalogModule.forRoot()
//   - validateBundleDraft (pure-function strict check)
//
// Coming next: BusinessTypesService (M3.2), MarketingProjectionService (M3.3).

export { BundlesService, type CatalogServiceConfig } from './bundles.service.js';
export { BusinessTypesService } from './business-types.service.js';
export { MarketingProjectionsService } from './marketing-projections.service.js';
export { CatalogEntriesService } from './catalog-entries.service.js';
export { buildCatalogEntriesController } from './catalog-entries.controller.js';
export { PromotionsService } from './promotions.service.js';
export { buildPromotionsController } from './promotions.controller.js';
export { MarketingSettingsService } from './marketing-settings.service.js';
export { buildMarketingSettingsController } from './marketing-settings.controller.js';
export { PublicMarketingCatalogService } from './public-marketing-catalog.service.js';
export { buildPublicMarketingCatalogController } from './public-marketing-catalog.controller.js';
export { PlansService } from './plans.service.js';
export { PlanVersionsService } from './plan-versions.service.js';
export { buildBundlesController, buildBundleVersionsController } from './bundles.controller.js';
export {
    buildBusinessTypesController,
    buildBusinessTypeVersionsController,
} from './business-types.controller.js';
export { buildMarketingProjectionsController } from './marketing-projections.controller.js';
export { buildPlansController, buildPlanVersionsController } from './plans.controller.js';
export {
    CatalogModule,
    type CatalogControllerConfig,
    type CatalogModuleOptions,
} from './catalog.module.js';
export {
    BUNDLE_REPOSITORY_TOKEN,
    BUSINESS_TYPE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    CATALOG_SERVICE_CONFIG_TOKEN,
    MARKETING_PROJECTION_REPOSITORY_TOKEN,
    MARKETING_SETTINGS_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
    PROMOTION_REPOSITORY_TOKEN,
} from './tokens.js';
export {
    ADVISORY_STRICT_MODE_CODES,
    blockingStrictModeWarnings,
    validateBundleDraft,
    validateBusinessTypeDraft,
    validatePlanDraft,
} from './strict-mode-check.js';
export { featureApprovalSignature, quotaApprovalSignature } from './approval-signature.js';
export { loadApprovedCatalogKeys } from './approved-keys.js';
export {
    formatPreflightReport,
    preflightExitCode,
    runPreflight,
    type PreflightFinding,
    type PreflightInput,
    type PreflightReport,
} from './preflight.js';
export {
    formatSeedGateReport,
    seedGateExitCode,
    validateSeedAgainstSnapshot,
    type SeedBundleDraft,
    type SeedGateFinding,
    type SeedGateInput,
    type SeedGateReport,
    type SeedPlanDraft,
} from './seed-gate.js';
export {
    runSeedGateFromFile,
    type SeedGateMode,
    type SeedGateRunOptions,
} from './seed-gate-runner.js';
export {
    CreateBundleDto,
    CreateBundleVersionDraftDto,
    PublishBundleVersionDto,
    UpdateBundleDto,
    UpdateBundleVersionDraftDto,
} from './dto/bundles.dto.js';
export {
    BusinessTypeBundleInputDto,
    CreateBusinessTypeDto,
    CreateBusinessTypeVersionDraftDto,
    PublishBusinessTypeVersionDto,
    UpdateBusinessTypeDto,
    UpdateBusinessTypeVersionDraftDto,
} from './dto/business-types.dto.js';
export {
    CreateMarketingProjectionDto,
    ListMarketingProjectionsQueryDto,
    UpdateMarketingProjectionDto,
} from './dto/marketing-projections.dto.js';
export {
    ListCatalogEntriesQueryDto,
    ReviewCatalogEntryDto,
    SyncDiscoveryDto,
    UpdateCatalogEntryI18nDto,
} from './dto/catalog-entries.dto.js';
export {
    CreatePromotionDto,
    ListPromotionsQueryDto,
    UpdatePromotionDto,
} from './dto/promotions.dto.js';
export {
    ListMarketingSettingsQueryDto,
    UpdateMarketingSettingsDto,
} from './dto/marketing-settings.dto.js';
export { CreatePlanDto, UpdatePlanDto } from './dto/plans.dto.js';
export {
    CreatePlanVersionDraftDto,
    PublishPlanVersionDto,
    UpdatePlanVersionDraftDto,
} from './dto/plan-versions.dto.js';

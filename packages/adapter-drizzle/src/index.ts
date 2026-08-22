// @saasicat/adapter-drizzle — Drizzle + PostgreSQL persistence adapter for
// the SaaS platform ports. Targets the canonical schema from
// `@saasicat/spec` (reference SQL / prisma-fragments) and passes the same
// `@saasicat/persistence-testing` contract as `@saasicat/adapter-prisma`.
//
// Contents:
//   - drizzlePersistence() — the aggregate SaasicatPersistenceAdapter bundle
//     for `SaasPlatformModule.forRoot({ persistence })`.
//   - DRIZZLE_DB_TOKEN + DrizzleClient — DI token + driver-independent db
//     type for manual wiring.
//   - Individual adapters and the query-side table map (`schema.js`).

export { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
export { drizzlePersistence, type DrizzlePersistenceOptions } from './drizzle-persistence.js';
export * as saasicatSchema from './schema.js';
export { DrizzleTransactionRunner } from './drizzle-transaction-runner.js';
export { DrizzleMfaAdapter } from './drizzle-mfa.adapter.js';
export { DrizzleAuditAdapter, buildActorTag } from './drizzle-audit.adapter.js';
export { DrizzleAuditQueryAdapter } from './drizzle-audit-query.adapter.js';
export { DrizzleAuditStatsAdapter } from './drizzle-audit-stats.adapter.js';
export { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
export { DrizzleSubscriptionRepository } from './drizzle-subscription.repository.js';
export { DrizzlePlanVersionRepository } from './drizzle-plan-version.repository.js';
export { DrizzlePromoCodeRepository } from './drizzle-promo-code.repository.js';
export { DrizzlePromoCodeRedemptionRepository } from './drizzle-promo-code-redemption.repository.js';
export { DrizzlePromoCodeValidationLogRepository } from './drizzle-promo-code-validation-log.repository.js';
export { DrizzlePromoSubscriptionLookup } from './drizzle-promo-subscription-lookup.js';
export { ZeroPromoRevenueDeductionAggregator } from './zero-promo-revenue-aggregator.js';
export {
    PASSWORD_HASHER_TOKEN,
    DrizzleSuperAdminBootstrapAdapter,
} from './drizzle-super-admin-bootstrap.adapter.js';
export { DrizzlePlanCatalogReadSink } from './drizzle-plan-catalog-read-sink.js';
export { DrizzlePlanCatalogImportSink } from './drizzle-plan-catalog-import-sink.js';

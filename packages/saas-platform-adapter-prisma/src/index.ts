// @saasicat/adapter-prisma — Prisma + PostgreSQL persistence adapter for the
// SaaS platform ports. Targets the canonical schema from
// `@saasicat/spec` prisma-fragments.
//
// Contents:
//   - prismaPersistence() — the aggregate SaasicatPersistenceAdapter bundle
//     for `SaasPlatformModule.forRoot({ persistence })`.
//   - PRISMA_CLIENT_TOKEN + PrismaLike/PrismaTxLike — DI token + structural
//     sub-interfaces for consumer PrismaService bindings.
//   - Individual adapters for manual wiring: MFA, audit (write/query/stats),
//     RLS bypass, transaction runner, subscription/plan-version/promo
//     repositories, SuperAdmin bootstrap, plan-catalog sinks.

export {
    PRISMA_CLIENT_TOKEN,
    type DecimalLike,
    type PrismaLike,
    type PrismaTxLike,
} from './prisma-client-token.js';
export { prismaPersistence, type PrismaPersistenceOptions } from './prisma-persistence.js';
export { PrismaTransactionRunner } from './prisma-transaction-runner.js';
export { PrismaMfaAdapter } from './prisma-mfa.adapter.js';
export { PrismaAuditAdapter, buildActorTag } from './prisma-audit.adapter.js';
export { PrismaAuditQueryAdapter } from './prisma-audit-query.adapter.js';
export { PrismaAuditStatsAdapter } from './prisma-audit-stats.adapter.js';
export { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
export { PrismaSubscriptionRepository } from './prisma-subscription.repository.js';
export { PrismaPlanVersionRepository } from './prisma-plan-version.repository.js';
export { PrismaPromoCodeRepository } from './prisma-promo-code.repository.js';
export { PrismaPromoCodeRedemptionRepository } from './prisma-promo-code-redemption.repository.js';
export { PrismaPromoCodeValidationLogRepository } from './prisma-promo-code-validation-log.repository.js';
export { PrismaPromoSubscriptionLookup } from './prisma-promo-subscription-lookup.js';
export { ZeroPromoRevenueDeductionAggregator } from './zero-promo-revenue-aggregator.js';
export {
    PASSWORD_HASHER_TOKEN,
    PrismaSuperAdminBootstrapAdapter,
} from './prisma-super-admin-bootstrap.adapter.js';
export { PrismaPlanCatalogReadSink } from './prisma-plan-catalog-read-sink.js';
export { PrismaPlanCatalogImportSink } from './prisma-plan-catalog-import-sink.js';

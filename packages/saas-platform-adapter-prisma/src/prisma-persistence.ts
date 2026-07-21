import type {
    PasswordHasher,
    PersistenceInjectionToken,
    PersistenceProvider,
    SaasicatPersistenceAdapter,
} from '@saasicat/types';
import type { PrismaLike } from './prisma-client-token.js';
import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
import { PrismaAuditAdapter } from './prisma-audit.adapter.js';
import { PrismaAuditQueryAdapter } from './prisma-audit-query.adapter.js';
import { PrismaAuditStatsAdapter } from './prisma-audit-stats.adapter.js';
import { PrismaMfaAdapter } from './prisma-mfa.adapter.js';
import { PrismaPlanCatalogImportSink } from './prisma-plan-catalog-import-sink.js';
import { PrismaPlanCatalogReadSink } from './prisma-plan-catalog-read-sink.js';
import { PrismaPlanVersionRepository } from './prisma-plan-version.repository.js';
import { PrismaPromoCodeRedemptionRepository } from './prisma-promo-code-redemption.repository.js';
import { PrismaPromoCodeRepository } from './prisma-promo-code.repository.js';
import { PrismaPromoCodeValidationLogRepository } from './prisma-promo-code-validation-log.repository.js';
import { PrismaPromoSubscriptionLookup } from './prisma-promo-subscription-lookup.js';
import { PrismaSubscriptionRepository } from './prisma-subscription.repository.js';
import { PrismaSuperAdminBootstrapAdapter } from './prisma-super-admin-bootstrap.adapter.js';
import { PrismaTransactionRunner } from './prisma-transaction-runner.js';
import { ZeroPromoRevenueDeductionAggregator } from './zero-promo-revenue-aggregator.js';

export interface PrismaPersistenceOptions {
    /**
     * The app's Prisma client: either its injection token (typically the
     * `PrismaService` class) — resolved through Nest DI at boot — or a ready
     * `PrismaLike` instance (tests, non-DI scripts).
     */
    client: PrismaLike | PersistenceInjectionToken;
    /**
     * App `PasswordHasher` (token or instance). Enables
     * `core.superAdminProvisioning` (setup wizard / create-super-admin);
     * without it the slice member stays absent.
     */
    passwordHasher?: PasswordHasher | PersistenceInjectionToken;
    /**
     * Set to true when the app's Prisma middleware really lifts RLS
     * (`SET LOCAL row_security = off`) while
     * `AsyncLocalRlsBypassAdapter.isBypassActive()`. Only toggles the
     * declared `rowLevelSecurity` capability — the adapter cannot verify the
     * middleware. Default false.
     */
    rlsIntegration?: boolean;
}

/**
 * Builds the `SaasicatPersistenceAdapter` bundle for Prisma + PostgreSQL on
 * the canonical schema (`@saasicat/spec` prisma-fragments):
 *
 * ```ts
 * SaasPlatformModule.forRoot({
 *     persistence: prismaPersistence({ client: PrismaService }),
 *     // ...
 * });
 * ```
 *
 * Slices not shipped by this adapter (contracts, bundles, registration,
 * tenant-billing write ports) stay absent — consumers keep providing custom
 * adapters for those features.
 */
export function prismaPersistence(options: PrismaPersistenceOptions): SaasicatPersistenceAdapter {
    const { client } = options;

    const provide = <T>(build: (prisma: PrismaLike) => T): PersistenceProvider<T> =>
        isInjectionToken(client)
            ? { useFactory: (prisma: PrismaLike) => build(prisma), inject: [client] }
            : build(client);

    return {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: options.rlsIntegration ?? false,
            advisoryLocks: false,
        },
        core: {
            mfa: provide((prisma) => new PrismaMfaAdapter(prisma)),
            audit: provide((prisma) => new PrismaAuditAdapter(prisma)),
            rlsBypass: new AsyncLocalRlsBypassAdapter(),
            transactionRunner: provide((prisma) => new PrismaTransactionRunner(prisma)),
            auditQuery: provide((prisma) => new PrismaAuditQueryAdapter(prisma)),
            auditStats: provide((prisma) => new PrismaAuditStatsAdapter(prisma)),
            superAdminProvisioning: buildProvisioning(client, options.passwordHasher),
        },
        entitlement: {
            subscriptionRepository: provide((prisma) => new PrismaSubscriptionRepository(prisma)),
            planVersionRepository: provide((prisma) => new PrismaPlanVersionRepository(prisma)),
        },
        promo: {
            promoCodeRepository: provide((prisma) => new PrismaPromoCodeRepository(prisma)),
            redemptionRepository: provide(
                (prisma) => new PrismaPromoCodeRedemptionRepository(prisma),
            ),
            validationLogRepository: provide(
                (prisma) => new PrismaPromoCodeValidationLogRepository(prisma),
            ),
            subscriptionLookup: provide((prisma) => new PrismaPromoSubscriptionLookup(prisma)),
            revenueAggregator: new ZeroPromoRevenueDeductionAggregator(),
        },
        planCatalogReadSink: provide((prisma) => new PrismaPlanCatalogReadSink(prisma)),
        planCatalogImportSink: provide((prisma) => new PrismaPlanCatalogImportSink(prisma)),
    };
}

function isInjectionToken(value: unknown): value is PersistenceInjectionToken {
    return (
        typeof value === 'function' || typeof value === 'symbol' || typeof value === 'string'
    );
}

function buildProvisioning(
    client: PrismaLike | PersistenceInjectionToken,
    hasher: PasswordHasher | PersistenceInjectionToken | undefined,
): PersistenceProvider<PrismaSuperAdminBootstrapAdapter> | undefined {
    if (hasher === undefined) return undefined;
    const clientIsToken = isInjectionToken(client);
    const hasherIsToken = isInjectionToken(hasher);
    if (clientIsToken && hasherIsToken) {
        return {
            useFactory: (prisma: PrismaLike, h: PasswordHasher) =>
                new PrismaSuperAdminBootstrapAdapter(prisma, h),
            inject: [client, hasher],
        };
    }
    if (clientIsToken) {
        return {
            useFactory: (prisma: PrismaLike) =>
                new PrismaSuperAdminBootstrapAdapter(prisma, hasher as PasswordHasher),
            inject: [client],
        };
    }
    if (hasherIsToken) {
        return {
            useFactory: (h: PasswordHasher) => new PrismaSuperAdminBootstrapAdapter(client, h),
            inject: [hasher],
        };
    }
    return new PrismaSuperAdminBootstrapAdapter(client, hasher);
}

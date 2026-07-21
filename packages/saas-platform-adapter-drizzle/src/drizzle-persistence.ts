import type {
    PasswordHasher,
    PersistenceInjectionToken,
    PersistenceProvider,
    SaasicatPersistenceAdapter,
} from '@saasicat/types';
import type { DrizzleClient } from './client.js';
import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
import { DrizzleAuditAdapter } from './drizzle-audit.adapter.js';
import { DrizzleAuditQueryAdapter } from './drizzle-audit-query.adapter.js';
import { DrizzleAuditStatsAdapter } from './drizzle-audit-stats.adapter.js';
import { DrizzleMfaAdapter } from './drizzle-mfa.adapter.js';
import { DrizzlePlanCatalogImportSink } from './drizzle-plan-catalog-import-sink.js';
import { DrizzlePlanCatalogReadSink } from './drizzle-plan-catalog-read-sink.js';
import { DrizzlePlanVersionRepository } from './drizzle-plan-version.repository.js';
import { DrizzlePromoCodeRedemptionRepository } from './drizzle-promo-code-redemption.repository.js';
import { DrizzlePromoCodeRepository } from './drizzle-promo-code.repository.js';
import { DrizzlePromoCodeValidationLogRepository } from './drizzle-promo-code-validation-log.repository.js';
import { DrizzlePromoSubscriptionLookup } from './drizzle-promo-subscription-lookup.js';
import { DrizzleSubscriptionRepository } from './drizzle-subscription.repository.js';
import { DrizzleSuperAdminBootstrapAdapter } from './drizzle-super-admin-bootstrap.adapter.js';
import { DrizzleTransactionRunner } from './drizzle-transaction-runner.js';
import { ZeroPromoRevenueDeductionAggregator } from './zero-promo-revenue-aggregator.js';

export interface DrizzlePersistenceOptions {
    /**
     * The app's Drizzle database: either a ready instance
     * (`drizzle(pool)` — typical, since Drizzle setups rarely wrap the db in
     * a Nest provider) or its injection token when the app registers one.
     */
    db: DrizzleClient | PersistenceInjectionToken;
    /**
     * App `PasswordHasher` (token or instance). Enables
     * `core.superAdminProvisioning` (setup wizard / create-super-admin);
     * without it the slice member stays absent.
     */
    passwordHasher?: PasswordHasher | PersistenceInjectionToken;
    /**
     * Set to true when the app's database layer really lifts RLS
     * (`SET LOCAL row_security = off`) while
     * `AsyncLocalRlsBypassAdapter.isBypassActive()`. Only toggles the
     * declared `rowLevelSecurity` capability. Default false.
     */
    rlsIntegration?: boolean;
}

/**
 * Builds the `SaasicatPersistenceAdapter` bundle for Drizzle + PostgreSQL on
 * the canonical schema (`@saasicat/spec` reference SQL):
 *
 * ```ts
 * const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
 *
 * SaasPlatformModule.forRoot({
 *     persistence: drizzlePersistence({ db }),
 *     // ...
 * });
 * ```
 *
 * Slices not shipped by this adapter (contracts, bundles, registration,
 * tenant-billing write ports) stay absent — identical to adapter-prisma;
 * both adapters pass the same `@saasicat/persistence-testing` contract.
 */
export function drizzlePersistence(options: DrizzlePersistenceOptions): SaasicatPersistenceAdapter {
    const { db } = options;

    const provide = <T>(build: (client: DrizzleClient) => T): PersistenceProvider<T> =>
        isInjectionToken(db)
            ? { useFactory: (client: DrizzleClient) => build(client), inject: [db] }
            : build(db);

    return {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: options.rlsIntegration ?? false,
            advisoryLocks: false,
        },
        core: {
            mfa: provide((client) => new DrizzleMfaAdapter(client)),
            audit: provide((client) => new DrizzleAuditAdapter(client)),
            rlsBypass: new AsyncLocalRlsBypassAdapter(),
            transactionRunner: provide((client) => new DrizzleTransactionRunner(client)),
            auditQuery: provide((client) => new DrizzleAuditQueryAdapter(client)),
            auditStats: provide((client) => new DrizzleAuditStatsAdapter(client)),
            superAdminProvisioning: buildProvisioning(db, options.passwordHasher),
        },
        entitlement: {
            subscriptionRepository: provide((client) => new DrizzleSubscriptionRepository(client)),
            planVersionRepository: provide((client) => new DrizzlePlanVersionRepository(client)),
        },
        promo: {
            promoCodeRepository: provide((client) => new DrizzlePromoCodeRepository(client)),
            redemptionRepository: provide(
                (client) => new DrizzlePromoCodeRedemptionRepository(client),
            ),
            validationLogRepository: provide(
                (client) => new DrizzlePromoCodeValidationLogRepository(client),
            ),
            subscriptionLookup: provide((client) => new DrizzlePromoSubscriptionLookup(client)),
            revenueAggregator: new ZeroPromoRevenueDeductionAggregator(),
        },
        planCatalogReadSink: provide((client) => new DrizzlePlanCatalogReadSink(client)),
        planCatalogImportSink: provide((client) => new DrizzlePlanCatalogImportSink(client)),
    };
}

function isInjectionToken(value: unknown): value is PersistenceInjectionToken {
    return typeof value === 'function' || typeof value === 'symbol' || typeof value === 'string';
}

function buildProvisioning(
    db: DrizzleClient | PersistenceInjectionToken,
    hasher: PasswordHasher | PersistenceInjectionToken | undefined,
): PersistenceProvider<DrizzleSuperAdminBootstrapAdapter> | undefined {
    if (hasher === undefined) return undefined;
    const dbIsToken = isInjectionToken(db);
    const hasherIsToken = isInjectionToken(hasher);
    if (dbIsToken && hasherIsToken) {
        return {
            useFactory: (client: DrizzleClient, h: PasswordHasher) =>
                new DrizzleSuperAdminBootstrapAdapter(client, h),
            inject: [db, hasher],
        };
    }
    if (dbIsToken) {
        return {
            useFactory: (client: DrizzleClient) =>
                new DrizzleSuperAdminBootstrapAdapter(client, hasher as PasswordHasher),
            inject: [db],
        };
    }
    if (hasherIsToken) {
        return {
            useFactory: (h: PasswordHasher) => new DrizzleSuperAdminBootstrapAdapter(db, h),
            inject: [hasher],
        };
    }
    return new DrizzleSuperAdminBootstrapAdapter(db, hasher);
}

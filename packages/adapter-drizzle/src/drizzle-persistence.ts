import type {
    PasswordHasher,
    PersistenceInjectionToken,
    PersistenceProvider,
    SaaSiCatPersistenceAdapter,
} from '@saasicat/core';
import type { DrizzleClient } from './client.js';
import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
import { DrizzleAuditAdapter } from './drizzle-audit.adapter.js';
import { DrizzleAuditQueryAdapter } from './drizzle-audit-query.adapter.js';
import { DrizzleAuditStatsAdapter } from './drizzle-audit-stats.adapter.js';
import { DrizzleMfaAdapter } from './drizzle-mfa.adapter.js';
import { DrizzlePlanCatalogImportSink } from './drizzle-plan-catalog-import-sink.adapter.js';
import { DrizzlePlanCatalogReadSink } from './drizzle-plan-catalog-read-sink.adapter.js';
import { DrizzlePlanVersionRepository } from './drizzle-plan-version.repository.js';
import { DrizzlePromoCodeRedemptionRepository } from './drizzle-promo-code-redemption.repository.js';
import { DrizzlePromoCodeRepository } from './drizzle-promo-code.repository.js';
import { DrizzleBundleRepository } from './drizzle-bundle.repository.js';
import { DrizzlePlanRepository } from './drizzle-plan.repository.js';
import { DrizzleSubscriptionBundleRepository } from './drizzle-subscription-bundle.repository.js';
import { DrizzlePromoCodeValidationLogRepository } from './drizzle-promo-code-validation-log.repository.js';
import { DrizzlePromoSubscriptionLookup } from './drizzle-promo-subscription-lookup.adapter.js';
import { DrizzleSubscriptionRepository } from './drizzle-subscription.repository.js';
import { DrizzleSuperAdminBootstrapAdapter } from './drizzle-super-admin-bootstrap.adapter.js';
import { DrizzleTransactionRunner } from './drizzle-transaction-runner.adapter.js';
import { ZeroPromoRevenueDeductionAggregator } from './zero-promo-revenue-aggregator.adapter.js';

export interface DrizzlePersistenceOptions {
    /**
     * Bundle-repository behaviour, mirroring `adapter-prisma`'s `bundle`
     * option. `validityWindows: true` opts into booking windows: a draft's
     * `validFrom`/`validUntil` are written and read, publishing closes the
     * predecessor's window, and `findActiveBundleVersion` is offered. Without
     * it the adapter says so by not exposing that method, rather than
     * answering with dates it does not maintain.
     */
    bundle?: { validityWindows?: boolean };

    /**
     * Plan-repository behaviour, the same opt-in one level up: with
     * `validityWindows: true` a plan version's `validFrom`/`validUntil` are
     * written and read, publishing closes the predecessor's window on the day
     * before the successor opens, and `findActivePlanVersion` is offered.
     */
    plan?: { validityWindows?: boolean };

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
 * Builds the `SaaSiCatPersistenceAdapter` bundle for Drizzle + PostgreSQL on
 * the canonical schema (`@saasicat/spec` reference SQL):
 *
 * ```ts
 * const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }));
 *
 * SaaSiCatModule.forRoot({
 *     persistence: drizzlePersistence({ db }),
 *     // ...
 * });
 * ```
 *
 * Slices not shipped by this adapter (catalog editing, contracts, bundles,
 * tenant-billing write ports) stay absent. Use the individual low-level
 * modules for those areas until the Drizzle bundle gains matching adapters.
 * Both adapters still pass the shared core persistence contract.
 */
export function drizzlePersistence(options: DrizzlePersistenceOptions): SaaSiCatPersistenceAdapter {
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
            // Entitlement reads the bookings as well as the plan: a tenant's
            // effective features are the union of the plan and the bundles
            // booked on top of it, so an adapter that omits this grants less
            // than the tenant paid for.
            subscriptionBundleRepository: provide(
                (client) => new DrizzleSubscriptionBundleRepository(client),
            ),
            // The catalogue behind those bookings: entitlement resolves a
            // booking's features by reading the pinned version.
            bundleRepository: provide(
                (client) => new DrizzleBundleRepository(client, options.bundle),
            ),
        },
        // The editable catalogue: which plans a project sells and in which
        // versions. Present since 2026-08-27 — before that this adapter could
        // read a plan version but not author one, so a Drizzle consumer had to
        // bring their own `CatalogModule` wiring for a slice the adapter was
        // otherwise complete for.
        catalog: {
            planRepository: provide((client) => new DrizzlePlanRepository(client, options.plan)),
            bundleRepository: provide(
                (client) => new DrizzleBundleRepository(client, options.bundle),
            ),
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

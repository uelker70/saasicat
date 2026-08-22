import type {
    PasswordHasher,
    PersistenceInjectionToken,
    PersistenceProvider,
    SaaSiCatPersistenceAdapter,
} from '@saasicat/types';
import type { PrismaLike } from './prisma-client-token.js';
import type { PrismaSchemaOptions } from './prisma-plan-binding.js';
import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
import { PrismaAuditAdapter } from './prisma-audit.adapter.js';
import { PrismaAuditQueryAdapter } from './prisma-audit-query.adapter.js';
import { PrismaAuditStatsAdapter } from './prisma-audit-stats.adapter.js';
import {
    PrismaAdminResourcesAdapter,
    type PrismaAdminResourcesOptions,
} from './prisma-admin-resources.adapter.js';
import {
    PrismaBundleRepository,
    type PrismaBundleRepositoryOptions,
} from './prisma-bundle.repository.js';
import { PrismaCatalogEntryRepository } from './prisma-catalog-entry.repository.js';
import { PrismaMarketingProjectionRepository } from './prisma-marketing-projection.repository.js';
import { PrismaMarketingSettingsRepository } from './prisma-marketing-settings.repository.js';
import { PrismaMfaAdapter } from './prisma-mfa.adapter.js';
import { PrismaPlanCatalogImportSink } from './prisma-plan-catalog-import-sink.adapter.js';
import { PrismaPlanCatalogReadSink } from './prisma-plan-catalog-read-sink.adapter.js';
import { PrismaPlanRepository } from './prisma-plan.repository.js';
import { PrismaPlanVersionRepository } from './prisma-plan-version.repository.js';
import { PrismaPromotionRepository } from './prisma-promotion.repository.js';
import { PrismaPromoCodeRedemptionRepository } from './prisma-promo-code-redemption.repository.js';
import { PrismaPromoCodeRepository } from './prisma-promo-code.repository.js';
import { PrismaPromoCodeValidationLogRepository } from './prisma-promo-code-validation-log.repository.js';
import { PrismaPromoSubscriptionLookup } from './prisma-promo-subscription-lookup.adapter.js';
import { PrismaSubscriptionBundleRepository } from './prisma-subscription-bundle.repository.js';
import { PrismaSubscriptionContractRepository } from './prisma-subscription-contract.repository.js';
import { PrismaSubscriptionRepository } from './prisma-subscription.repository.js';
import { PrismaSubscriptionUsageAdapter } from './prisma-subscription-usage.adapter.js';
import { PrismaSuperAdminBootstrapAdapter } from './prisma-super-admin-bootstrap.adapter.js';
import { PrismaTenantSubscriptionWriteAdapter } from './prisma-tenant-subscription-write.adapter.js';
import { PrismaTransactionRunner } from './prisma-transaction-runner.adapter.js';
import { ZeroPromoRevenueDeductionAggregator } from './zero-promo-revenue-aggregator.adapter.js';

/** Additional delegates present when the canonical catalog fragments are installed. */
interface CanonicalPersistencePrisma extends PrismaLike {
    bundle: unknown;
    bundleVersion: unknown;
    subscriptionBundle: unknown;
    capabilityCatalogEntry: unknown;
    quotaCatalogEntry: unknown;
    marketingProjection: unknown;
    promotion: unknown;
    marketingSettings: unknown;
}

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
    /**
     * Optional plan-schema adaptations. Omitted means the exact 0.6 layout:
     * soft `planId === planKey`, one `planVersion` delegate, no validity or
     * termination columns.
     */
    schema?: PrismaSchemaOptions;
    /**
     * Standard SuperAdmin Tenant/User/Audit/Subscription pages. Set `false`
     * for schemas without conventional `tenant`/`user` delegates.
     */
    adminResources?: false | PrismaAdminResourcesOptions;
    /**
     * Options for the bundle repository the catalog and entitlement slices
     * share — notably `{ validityWindows: true }` for schemas that carry
     * `BundleVersion.validFrom`/`validUntil`.
     *
     * Without this the bundle builds the repository with its 0.6-compatible
     * defaults, and the repository's `@Optional() @Inject(...)` options
     * provider never applies, because the bundle constructs the instance
     * directly rather than through Nest DI.
     */
    bundle?: PrismaBundleRepositoryOptions;
}

/**
 * Builds the `SaaSiCatPersistenceAdapter` bundle for Prisma + PostgreSQL on
 * the canonical schema (`@saasicat/spec` prisma-fragments):
 *
 * ```ts
 * SaaSiCatModule.forRoot({
 *     persistence: prismaPersistence({ client: PrismaService }),
 *     // ...
 * });
 * ```
 *
 * The bundle covers the complete canonical core, entitlement, catalog,
 * tenant-billing, promo and plan-catalog persistence. App-specific behavior
 * such as quota counters and authentication remains in the consumer.
 */
export function prismaPersistence(options: PrismaPersistenceOptions): SaaSiCatPersistenceAdapter {
    const { client } = options;

    const provide = <T>(build: (prisma: PrismaLike) => T): PersistenceProvider<T> =>
        isInjectionToken(client)
            ? { useFactory: (prisma: PrismaLike) => build(prisma), inject: [client] }
            : build(client);

    const bundle: SaaSiCatPersistenceAdapter = {
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
            subscriptionRepository: provide(
                (prisma) => new PrismaSubscriptionRepository(prisma, options.schema),
            ),
            planVersionRepository: provide(
                (prisma) => new PrismaPlanVersionRepository(prisma, options.schema),
            ),
            subscriptionContractRepository: provide(
                (prisma) => new PrismaSubscriptionContractRepository(prisma),
            ),
            subscriptionBundleRepository: provide(
                (prisma) => new PrismaSubscriptionBundleRepository(canonical(prisma)),
            ),
            bundleRepository: provide(
                (prisma) => new PrismaBundleRepository(canonical(prisma), options.bundle),
            ),
        },
        catalog: {
            planRepository: provide((prisma) => new PrismaPlanRepository(prisma, options.schema)),
            bundleRepository: provide(
                (prisma) => new PrismaBundleRepository(canonical(prisma), options.bundle),
            ),
            catalogEntryRepository: provide(
                (prisma) => new PrismaCatalogEntryRepository(canonical(prisma)),
            ),
            marketingProjectionRepository: provide(
                (prisma) => new PrismaMarketingProjectionRepository(canonical(prisma)),
            ),
            promotionRepository: provide(
                (prisma) => new PrismaPromotionRepository(canonical(prisma)),
            ),
            marketingSettingsRepository: provide(
                (prisma) => new PrismaMarketingSettingsRepository(canonical(prisma)),
            ),
        },
        tenantBilling: {
            subscriptionUsagePort: provide(
                (prisma) => new PrismaSubscriptionUsageAdapter(prisma, options.schema),
            ),
            subscriptionWritePort: provide(
                (prisma) => new PrismaTenantSubscriptionWriteAdapter(prisma, options.schema),
            ),
        },
        adminResources:
            options.adminResources === false
                ? undefined
                : {
                      resources: provide(
                          (prisma) =>
                              new PrismaAdminResourcesAdapter(
                                  prisma,
                                  options.adminResources || undefined,
                              ),
                      ),
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
        planCatalogReadSink: provide(
            (prisma) => new PrismaPlanCatalogReadSink(prisma, options.schema),
        ),
        planCatalogImportSink: provide(
            (prisma) => new PrismaPlanCatalogImportSink(prisma, options.schema),
        ),
    };
    return bundle;
}

function canonical(prisma: PrismaLike): CanonicalPersistencePrisma {
    return prisma as CanonicalPersistencePrisma;
}

function isInjectionToken(value: unknown): value is PersistenceInjectionToken {
    return typeof value === 'function' || typeof value === 'symbol' || typeof value === 'string';
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

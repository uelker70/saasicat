// Persistence adapter bundle — the aggregate contract a persistence adapter
// package (e.g. `@saasicat/adapter-prisma`) exposes so consumers wire ONE
// object into `SaasPlatformModule.forRoot({ persistence })` instead of
// binding every repository token manually.
//
// The bundle does not replace the fine-grained ports (they stay the single
// source of truth for behavior); it only groups implementations of those
// ports into named slices. A slice that an adapter does not ship is simply
// absent — the platform modules that need it then require manual bindings.
//
// One bundle per app: `TransactionContext` is opaque and only consistent
// within a single adapter — mixing repositories from different adapters in
// one transaction is undefined behavior.

import type {
    MfaPort,
    SuperAdminProvisioningPort,
    TransactionRunner,
} from './core-ports.types.js';
import type {
    AuditPort,
    AuditQueryPort,
    AuditStatsPort,
    RlsBypassPort,
} from './admin-ports.types.js';
import type {
    PlanVersionRepository,
    SubscriptionBundleRepository,
    SubscriptionContractRepository,
    SubscriptionRepository,
} from './billing-ports.types.js';
import type { BundleRepository } from './catalog-ports.types.js';
import type {
    PromoCodeRedemptionRepository,
    PromoCodeRepository,
    PromoCodeValidationLogRepository,
    PromoRevenueDeductionAggregator,
    PromoSubscriptionLookup,
} from './promo-ports.types.js';
import type { PlanCatalogImportSink, PlanCatalogReadSink } from '../plan-catalog-import.types.js';

/** Class reference usable as a DI token (e.g. the consumer's `PrismaService`). */
export type PersistenceClassRef = abstract new (...args: never[]) => unknown;

/** DI token forms a persistence bundle may reference in `inject`. */
export type PersistenceInjectionToken = string | symbol | PersistenceClassRef;

/**
 * Framework-free equivalent of the NestJS `ProviderSpec<T>`: either a ready
 * instance or a `{ useFactory, inject }` factory description. Structurally
 * assignable to `ProviderSpec<T>` in `@saasicat/nest`, so bundle fields can
 * be passed to every `*.forRoot()` option unchanged.
 */
export type PersistenceProvider<T> =
    | T
    | {
          useFactory: (...deps: never[]) => T | Promise<T>;
          inject?: PersistenceInjectionToken[];
      };

/**
 * Capabilities a persistence adapter guarantees. The platform fail-fasts at
 * boot when a required capability is missing, instead of silently degrading
 * correctness (e.g. quota enforcement without row locks).
 *
 * These flags describe the ADAPTER + DATABASE combination, not the abstract
 * ORM: an adapter may set `pessimisticLocking: false` when it targets a
 * backend without `SELECT ... FOR UPDATE` semantics.
 */
export interface PersistenceCapabilities {
    /**
     * `TransactionRunner.run` opens a real ACID transaction: throwing inside
     * the callback rolls back every write performed through the passed
     * `TransactionContext`.
     */
    transactions: boolean;
    /**
     * `SubscriptionRepository.findByTenantIdLocked` takes a row lock
     * (`SELECT ... FOR UPDATE`) that serializes concurrent transactions on
     * the same tenant. Required for the transactional `enforceLimit()` path.
     */
    pessimisticLocking: boolean;
    /**
     * The adapter stack integrates with Postgres row-level security (the
     * `RlsBypassPort` frame actually lifts RLS for SuperAdmin reads).
     * Informational — RLS policies themselves remain consumer-owned.
     */
    rowLevelSecurity: boolean;
    /** Advisory-lock support (`pg_advisory_*`). No platform path requires it today. */
    advisoryLocks: boolean;
}

/** Always-required slice: admin surface + transactions. */
export interface SaasicatPersistenceCore {
    mfa: PersistenceProvider<MfaPort>;
    audit: PersistenceProvider<AuditPort>;
    rlsBypass: PersistenceProvider<RlsBypassPort>;
    transactionRunner: PersistenceProvider<TransactionRunner>;
    /** First-run setup wizard (`SetupModule`). */
    superAdminProvisioning?: PersistenceProvider<SuperAdminProvisioningPort>;
    /** Read side for `<app> audit tail` and admin audit pages. */
    auditQuery?: PersistenceProvider<AuditQueryPort>;
    /** Aggregation for the admin stats dashboard. */
    auditStats?: PersistenceProvider<AuditStatsPort>;
}

/** Repositories for the entitlement/contract loop (`EntitlementModule`). */
export interface SaasicatPersistenceEntitlement {
    subscriptionRepository: PersistenceProvider<SubscriptionRepository>;
    planVersionRepository: PersistenceProvider<PlanVersionRepository>;
    subscriptionContractRepository?: PersistenceProvider<SubscriptionContractRepository>;
    subscriptionBundleRepository?: PersistenceProvider<SubscriptionBundleRepository>;
    bundleRepository?: PersistenceProvider<BundleRepository>;
}

/**
 * Repositories for `PromoCodesModule.forRoot`. Field names match the module
 * options so the slice can be spread into the options object. The
 * app-semantic `firstTimeCustomerCheck` is deliberately NOT part of the
 * bundle — what counts as an existing customer is a consumer decision.
 */
export interface SaasicatPersistencePromo {
    promoCodeRepository: PersistenceProvider<PromoCodeRepository>;
    redemptionRepository: PersistenceProvider<PromoCodeRedemptionRepository>;
    validationLogRepository: PersistenceProvider<PromoCodeValidationLogRepository>;
    subscriptionLookup: PersistenceProvider<PromoSubscriptionLookup>;
    revenueAggregator: PersistenceProvider<PromoRevenueDeductionAggregator>;
}

/**
 * Aggregate persistence bundle. Produced by adapter factories such as
 * `prismaPersistence({ client })`; consumed by
 * `SaasPlatformModule.forRoot({ persistence })` and — for slices the mega
 * module does not wire — spread into the per-domain `forRoot` options.
 */
export interface SaasicatPersistenceAdapter {
    capabilities: PersistenceCapabilities;
    core: SaasicatPersistenceCore;
    entitlement?: SaasicatPersistenceEntitlement;
    promo?: SaasicatPersistencePromo;
    /** DB hydration of the plan catalog at boot (`PlanCatalogModule`). */
    planCatalogReadSink?: PersistenceProvider<PlanCatalogReadSink>;
    /** One-shot `saas.yaml → DB` import. */
    planCatalogImportSink?: PersistenceProvider<PlanCatalogImportSink>;
}

/** Options for capability assertions raised by platform modules at boot. */
export interface RequiredCapabilities {
    transactions?: boolean;
    pessimisticLocking?: boolean;
    rowLevelSecurity?: boolean;
    advisoryLocks?: boolean;
}

/**
 * Thrown when a persistence adapter does not provide a capability the
 * enabled platform feature set requires. Framework-free so both nest and
 * CLI surfaces can map it.
 */
export class PersistenceCapabilityError extends Error {
    readonly code = 'PERSISTENCE_CAPABILITY_MISSING';
    constructor(
        readonly missing: Array<keyof PersistenceCapabilities>,
        readonly requiredBy: string,
    ) {
        super(
            `${requiredBy} requires persistence capabilities the configured adapter does not provide: ` +
                `${missing.join(', ')}. Use an adapter/database that supports them or disable the feature.`,
        );
        this.name = 'PersistenceCapabilityError';
    }
}

/**
 * Validates declared capabilities against a feature's requirements. Throws
 * `PersistenceCapabilityError` listing every missing capability.
 */
export function assertPersistenceCapabilities(
    capabilities: PersistenceCapabilities,
    required: RequiredCapabilities,
    requiredBy: string,
): void {
    const missing = (Object.keys(required) as Array<keyof PersistenceCapabilities>).filter(
        (key) => required[key] && !capabilities[key],
    );
    if (missing.length > 0) {
        throw new PersistenceCapabilityError(missing, requiredBy);
    }
}

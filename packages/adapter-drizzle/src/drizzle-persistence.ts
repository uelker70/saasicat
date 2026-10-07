import {
    membersLeftOut,
    type OptionalBundleMember,
    type OptionalCanonicalModel,
    type PasswordHasher,
    type PersistenceInjectionToken,
    type PersistenceProvider,
    type SaaSiCatPersistenceAdapter,
} from '@saasicat/core';
import type { DrizzleClient } from './client.js';
import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
import { DrizzleAppliedSettingsRepository } from './drizzle-applied-settings.repository.js';
import { DrizzleAuditAdapter } from './drizzle-audit.adapter.js';
import { DrizzleAuditQueryAdapter } from './drizzle-audit-query.adapter.js';
import { DrizzleAuditStatsAdapter } from './drizzle-audit-stats.adapter.js';
import { DrizzleMaintenanceWindowRepository } from './drizzle-maintenance-window.repository.js';
import { DrizzleSubscriptionNoticeRepository } from './drizzle-subscription-notice.repository.js';
import { DrizzleVersionRetirementRepository } from './drizzle-version-retirement.repository.js';
import { DrizzleBundleVersionRetirementRepository } from './drizzle-bundle-version-retirement.repository.js';
import { DrizzleFeatureWithdrawalRepository } from './drizzle-feature-withdrawal.repository.js';
import { DrizzleMfaAdapter } from './drizzle-mfa.adapter.js';
import { DrizzlePlanCatalogImportSink } from './drizzle-plan-catalog-import-sink.adapter.js';
import { DrizzlePlanCatalogReadSink } from './drizzle-plan-catalog-read-sink.adapter.js';
import { DrizzlePaymentEventLog } from './drizzle-payment-event-log.adapter.js';
import { DrizzlePlanVersionRepository } from './drizzle-plan-version.repository.js';
import { DrizzlePromoCodeHoldRepository } from './drizzle-promo-code-hold.repository.js';
import { DrizzlePromoCodeRedemptionRepository } from './drizzle-promo-code-redemption.repository.js';
import { DrizzlePromoCodeRepository } from './drizzle-promo-code.repository.js';
import { DrizzleBundleRepository } from './drizzle-bundle.repository.js';
import { DrizzlePlanRepository } from './drizzle-plan.repository.js';
import { DrizzleSubscriptionContractRepository } from './drizzle-subscription-contract.repository.js';
import { DrizzleSubscriberLedgerRepository } from './drizzle-subscriber-ledger.repository.js';
import { DrizzleSubscriberPaymentMethodRepository } from './drizzle-subscriber-payment-method.repository.js';
import { DrizzleSubscriberRepository } from './drizzle-subscriber.repository.js';
import { DrizzleSubscriptionUsageAdapter } from './drizzle-subscription-usage.adapter.js';
import { DrizzleTenantSubscriptionWrite } from './drizzle-tenant-subscription-write.adapter.js';
import { DrizzleSubscriptionBundleRepository } from './drizzle-subscription-bundle.repository.js';
import { DrizzlePromoCodeValidationLogRepository } from './drizzle-promo-code-validation-log.repository.js';
import { DrizzlePromoSubscriptionLookup } from './drizzle-promo-subscription-lookup.adapter.js';
import { DrizzleSubscriptionRepository } from './drizzle-subscription.repository.js';
import { DrizzleSuperAdminBootstrapAdapter } from './drizzle-super-admin-bootstrap.adapter.js';
import {
    DrizzleTransactionRunner,
    type DrizzleTransactionOptions,
} from './drizzle-transaction-runner.adapter.js';
import { ZeroPromoRevenueDeductionAggregator } from './zero-promo-revenue-aggregator.adapter.js';

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
     * Declares the `rowLevelSecurity` capability, and does nothing else: this
     * bundle does not lift a row policy, unlike the Prisma one. An
     * installation with row policies binds an `RlsBypassPort` of its own in
     * `adapters` that runs the work in one transaction with the setting its
     * policies read, and sets this beside it. Default false.
     */
    rlsIntegration?: boolean;
    /**
     * The canonical models your schema leaves out, as `saasicat schema check`
     * lists them under "Not adopted". The bundle leaves out the members that
     * need them, so the platform decides at start what it can do without them
     * rather than a request failing on a table that is not there. Only models
     * the bundle can do without are accepted (`OPTIONAL_CANONICAL_MODELS`);
     * for any other, pass your own adapter.
     */
    notAdopted?: readonly OptionalCanonicalModel[];
    /**
     * How many of the platform's transactions run at once: `maxConcurrent`
     * below your pool's `max`. Unset, the transactions are unbounded.
     */
    transactions?: DrizzleTransactionOptions;
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
    const leftOut = membersLeftOut(options.notAdopted);
    if (options.passwordHasher && leftOut.has('core.superAdminProvisioning')) {
        throw new Error(
            'drizzlePersistence: `passwordHasher` provisions SuperAdmins into `super_admin_users`, ' +
                'and `notAdopted` says the schema has no such table. Drop one of the two.',
        );
    }
    /** The member, unless a model it needs is not adopted. */
    const unless = <T>(member: OptionalBundleMember, value: T): T | undefined =>
        leftOut.has(member) ? undefined : value;

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
            mfa: unless(
                'core.mfa',
                provide((client) => new DrizzleMfaAdapter(client)),
            ),
            audit: provide((client) => new DrizzleAuditAdapter(client)),
            rlsBypass: new AsyncLocalRlsBypassAdapter(),
            transactionRunner: provide(
                (client) => new DrizzleTransactionRunner(client, options.transactions),
            ),
            auditQuery: provide((client) => new DrizzleAuditQueryAdapter(client)),
            auditStats: provide((client) => new DrizzleAuditStatsAdapter(client)),
            superAdminProvisioning: buildProvisioning(db, options.passwordHasher),
            appliedSettings: unless(
                'core.appliedSettings',
                provide((client) => new DrizzleAppliedSettingsRepository(client)),
            ),
            maintenanceWindows: unless(
                'core.maintenanceWindows',
                provide((client) => new DrizzleMaintenanceWindowRepository(client)),
            ),
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
            // What the tenant actually agreed to, frozen at signing. Entitlement
            // prefers it over the live catalogue where it exists, which is what
            // makes a price change stop at the contracts already signed.
            subscriptionContractRepository: provide(
                (client) => new DrizzleSubscriptionContractRepository(client),
            ),
            // The party each of those contracts is concluded with.
            subscriberRepository: provide((client) => new DrizzleSubscriberRepository(client)),
            // The charges those contracts give rise to, written once each.
            subscriberLedgerRepository: unless(
                'entitlement.subscriberLedgerRepository',
                provide((client) => new DrizzleSubscriberLedgerRepository(client)),
            ),
            // The catalogue behind those bookings: entitlement resolves a
            // booking's features by reading the pinned version.
            bundleRepository: provide((client) => new DrizzleBundleRepository(client)),
        },
        // The editable catalogue: which plans a project sells and in which
        // versions. Present since 2026-08-27 — before that this adapter could
        // read a plan version but not author one, so a Drizzle consumer had to
        // bring their own `CatalogModule` wiring for a slice the adapter was
        // otherwise complete for.
        catalog: {
            planRepository: provide((client) => new DrizzlePlanRepository(client)),
            bundleRepository: provide((client) => new DrizzleBundleRepository(client)),
        },
        // The tenant's own billing page and the writes behind its buttons.
        // Both members are required, and until 2026-08-27 neither existed —
        // which left `DrizzleTenantSubscriptionWrite` unreachable through the
        // documented `drizzlePersistence({ db })` path however complete it was.
        tenantBilling: {
            subscriptionUsagePort: provide((client) => new DrizzleSubscriptionUsageAdapter(client)),
            subscriptionWritePort: provide((client) => new DrizzleTenantSubscriptionWrite(client)),
            subscriptionNotices: unless(
                'tenantBilling.subscriptionNotices',
                provide((client) => new DrizzleSubscriptionNoticeRepository(client)),
            ),
            versionRetirements: unless(
                'tenantBilling.versionRetirements',
                provide((client) => new DrizzleVersionRetirementRepository(client)),
            ),
            bundleVersionRetirements: unless(
                'tenantBilling.bundleVersionRetirements',
                provide((client) => new DrizzleBundleVersionRetirementRepository(client)),
            ),
            featureWithdrawals: unless(
                'tenantBilling.featureWithdrawals',
                provide((client) => new DrizzleFeatureWithdrawalRepository(client)),
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
            holdRepository: unless(
                'promo.holdRepository',
                provide((client) => new DrizzlePromoCodeHoldRepository(client)),
            ),
        },
        payments: {
            paymentEventLog: provide((client) => new DrizzlePaymentEventLog(client)),
            subscriberPaymentMethodRepository: provide(
                (client) => new DrizzleSubscriberPaymentMethodRepository(client),
            ),
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

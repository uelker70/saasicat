import {
    membersLeftOut,
    type OptionalBundleMember,
    type OptionalCanonicalModel,
    type PasswordHasher,
    type PersistenceInjectionToken,
    type PersistenceProvider,
    type SaaSiCatPersistenceAdapter,
} from '@saasicat/core';
import type { PrismaLike, PrismaTxLike } from './prisma-client-token.js';
import type { PrismaSchemaOptions } from './prisma-plan-binding.js';
import { AsyncLocalRlsBypassAdapter } from './async-local-rls-bypass.adapter.js';
import { PrismaRlsBypass } from './prisma-rls-bypass.js';
import { PrismaAppliedSettingsRepository } from './prisma-applied-settings.repository.js';
import { PrismaAuditAdapter } from './prisma-audit.adapter.js';
import { PrismaAuditQueryAdapter } from './prisma-audit-query.adapter.js';
import { PrismaAuditStatsAdapter } from './prisma-audit-stats.adapter.js';
import {
    PrismaAdminResourcesAdapter,
    type PrismaAdminResourcesOptions,
} from './prisma-admin-resources.adapter.js';
import { PrismaBundleRepository } from './prisma-bundle.repository.js';
import { PrismaCatalogEntryRepository } from './prisma-catalog-entry.repository.js';
import { PrismaMarketingProjectionRepository } from './prisma-marketing-projection.repository.js';
import { PrismaMaintenanceWindowRepository } from './prisma-maintenance-window.repository.js';
import { PrismaSubscriptionNoticeRepository } from './prisma-subscription-notice.repository.js';
import { PrismaVersionRetirementRepository } from './prisma-version-retirement.repository.js';
import { PrismaBundleVersionRetirementRepository } from './prisma-bundle-version-retirement.repository.js';
import { PrismaMarketingSettingsRepository } from './prisma-marketing-settings.repository.js';
import { PrismaMfaAdapter } from './prisma-mfa.adapter.js';
import { PrismaPlanCatalogImportSink } from './prisma-plan-catalog-import-sink.adapter.js';
import { PrismaPlanCatalogReadSink } from './prisma-plan-catalog-read-sink.adapter.js';
import { PrismaPlanRepository } from './prisma-plan.repository.js';
import { PrismaPaymentEventLog } from './prisma-payment-event-log.adapter.js';
import { PrismaPlanVersionRepository } from './prisma-plan-version.repository.js';
import { PrismaPromotionRepository } from './prisma-promotion.repository.js';
import { PrismaPromoCodeHoldRepository } from './prisma-promo-code-hold.repository.js';
import { PrismaPromoCodeRedemptionRepository } from './prisma-promo-code-redemption.repository.js';
import { PrismaPromoCodeRepository } from './prisma-promo-code.repository.js';
import { PrismaPromoCodeValidationLogRepository } from './prisma-promo-code-validation-log.repository.js';
import { PrismaPromoSubscriptionLookup } from './prisma-promo-subscription-lookup.adapter.js';
import { PrismaSubscriptionBundleRepository } from './prisma-subscription-bundle.repository.js';
import { PrismaSubscriptionContractRepository } from './prisma-subscription-contract.repository.js';
import { PrismaSubscriberLedgerRepository } from './prisma-subscriber-ledger.repository.js';
import { PrismaSubscriptionInvoiceRepository } from './prisma-subscription-invoice.repository.js';
import { PrismaSubscriberPaymentMethodRepository } from './prisma-subscriber-payment-method.repository.js';
import { PrismaSubscriberRepository } from './prisma-subscriber.repository.js';
import { PrismaSubscriptionRepository } from './prisma-subscription.repository.js';
import { PrismaSubscriptionUsageAdapter } from './prisma-subscription-usage.adapter.js';
import { PrismaSuperAdminBootstrapAdapter } from './prisma-super-admin-bootstrap.adapter.js';
import { PrismaTenantSubscriptionWriteAdapter } from './prisma-tenant-subscription-write.adapter.js';
import {
    PrismaTransactionRunner,
    type PrismaTransactionOptions,
} from './prisma-transaction-runner.adapter.js';
import { ZeroPromoRevenueDeductionAggregator } from './zero-promo-revenue-aggregator.adapter.js';

/** Additional delegates present when the canonical catalog fragments are installed. */
interface CanonicalPersistencePrisma extends PrismaLike {
    subscriptionContract: unknown;
    promoCodeHold: unknown;
    bundle: unknown;
    bundleVersion: unknown;
    subscriptionBundle: unknown;
    capabilityCatalogEntry: unknown;
    quotaCatalogEntry: unknown;
    marketingProjection: unknown;
    promotion: unknown;
    marketingSettings: unknown;
    appliedSettings: unknown;
    settingsChange: unknown;
    maintenanceWindow: unknown;
    subscriber: unknown;
    subscriberTenant: unknown;
    subscriberCorrection: unknown;
    subscriberPaymentMethod: unknown;
    subscriberPaymentMethodSetup: unknown;
    subscriberLedgerEntry: unknown;
    subscriptionInvoice: unknown;
    subscriptionNotice: unknown;
}

/**
 * The delegates of `PrismaLike` that a model left out takes with it. Only the
 * SuperAdmin models have one there; the adapters reach every other optional
 * model through a type of their own.
 */
interface DelegatesOfModel {
    SuperAdminUser: 'superAdminUser';
    SuperAdminMfa: 'superAdminMfa';
}

type TxWithout<M extends OptionalCanonicalModel> = Omit<
    PrismaTxLike,
    DelegatesOfModel[M & keyof DelegatesOfModel]
>;

/** A client generated from a schema that leaves the models `M` out. */
type PrismaClientWithout<M extends OptionalCanonicalModel> = TxWithout<M> & {
    $transaction<T>(fn: (tx: TxWithout<M>) => Promise<T>): Promise<T>;
};

export interface PrismaPersistenceOptions<M extends OptionalCanonicalModel = never> {
    /**
     * The app's Prisma client: either its injection token (typically the
     * `PrismaService` class) — resolved through Nest DI at boot — or a ready
     * `PrismaLike` instance (tests, non-DI scripts), which needs no delegate
     * of a model named in `notAdopted`.
     */
    client: PrismaClientWithout<M> | PersistenceInjectionToken;
    /**
     * App `PasswordHasher` (token or instance). Enables
     * `core.superAdminProvisioning` (setup wizard / create-super-admin);
     * without it the slice member stays absent.
     */
    passwordHasher?: PasswordHasher | PersistenceInjectionToken;
    /**
     * Row-level security: the bundle lifts the installation's row policies
     * for what the platform does across tenants. Every statement its adapters
     * run inside the platform's `runWithBypass` — a read, a write or a raw
     * statement — runs in one transaction with
     * `set_config('app.bypass_rls', 'true', true)`, and a policy that accepts
     * that setting lets it through. Your own tenant scoping stays yours; see
     * the README for the policy.
     *
     * `true` builds the bypass. Pass a `PrismaRlsBypass` of your own to name
     * another setting, or to lift statements of your own with the same port:
     * `bypass.extend(prisma)`.
     *
     * Leave it out where the database has no row policies, or where you bind
     * an `RlsBypassPort` of your own in `adapters`.
     */
    rlsIntegration?: boolean | PrismaRlsBypass;
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
     * The canonical models your schema leaves out, as `saasicat schema check`
     * lists them under "Not adopted". The bundle leaves out the members that
     * need them, so the platform decides at start what it can do without them
     * rather than a request failing on a table that is not there. Only models
     * the bundle can do without are accepted (`OPTIONAL_CANONICAL_MODELS`);
     * for any other, pass your own adapter.
     */
    notAdopted?: readonly M[];
    /**
     * How the platform's transactions run against the pool: `maxConcurrent`
     * below your pool size, and Prisma's `timeout` and `maxWait`. Unset, the
     * transactions are unbounded and use Prisma's defaults.
     */
    transactions?: PrismaTransactionOptions;
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
export function prismaPersistence<M extends OptionalCanonicalModel = never>(
    options: PrismaPersistenceOptions<M>,
): SaaSiCatPersistenceAdapter {
    const leftOut = membersLeftOut(options.notAdopted);
    // The whole client type from here on: a member that uses a delegate the
    // client may lack is one `leftOut` names, and is never built.
    const client = options.client as PrismaLike | PersistenceInjectionToken;
    if (options.passwordHasher && leftOut.has('core.superAdminProvisioning')) {
        throw new Error(
            'prismaPersistence: `passwordHasher` provisions SuperAdmins into `super_admin_users`, ' +
                'and `notAdopted` says the schema has no such table. Drop one of the two.',
        );
    }
    /** The member, unless a model it needs is not adopted. */
    const unless = <T>(member: OptionalBundleMember, value: T): T | undefined =>
        leftOut.has(member) ? undefined : value;

    const rls = rlsBypassOf(options.rlsIntegration);
    // Every adapter gets the client the bypass lifts, and all of them the same
    // one, so a transaction the runner opens is the one they write through.
    const lifted = (prisma: PrismaLike): PrismaLike => (rls ? rls.extend(prisma) : prisma);
    const provide = <T>(build: (prisma: PrismaLike) => T): PersistenceProvider<T> =>
        isInjectionToken(client)
            ? { useFactory: (prisma: PrismaLike) => build(lifted(prisma)), inject: [client] }
            : build(lifted(client));

    const bundle: SaaSiCatPersistenceAdapter = {
        capabilities: {
            transactions: true,
            pessimisticLocking: true,
            rowLevelSecurity: rls !== undefined,
            advisoryLocks: false,
        },
        core: {
            mfa: unless(
                'core.mfa',
                provide((prisma) => new PrismaMfaAdapter(prisma)),
            ),
            audit: provide((prisma) => new PrismaAuditAdapter(prisma)),
            rlsBypass: rls?.port ?? new AsyncLocalRlsBypassAdapter(),
            transactionRunner: provide(
                (prisma) => new PrismaTransactionRunner(prisma, options.transactions),
            ),
            auditQuery: provide((prisma) => new PrismaAuditQueryAdapter(prisma)),
            auditStats: provide((prisma) => new PrismaAuditStatsAdapter(prisma)),
            superAdminProvisioning: buildProvisioning(client, options.passwordHasher, lifted),
            appliedSettings: unless(
                'core.appliedSettings',
                provide((prisma) => new PrismaAppliedSettingsRepository(canonical(prisma))),
            ),
            maintenanceWindows: unless(
                'core.maintenanceWindows',
                provide((prisma) => new PrismaMaintenanceWindowRepository(canonical(prisma))),
            ),
        },
        entitlement: {
            subscriptionRepository: provide(
                (prisma) => new PrismaSubscriptionRepository(prisma, options.schema),
            ),
            planVersionRepository: provide(
                (prisma) => new PrismaPlanVersionRepository(prisma, options.schema),
            ),
            subscriptionContractRepository: provide(
                (prisma) => new PrismaSubscriptionContractRepository(canonical(prisma)),
            ),
            subscriberRepository: provide(
                (prisma) => new PrismaSubscriberRepository(canonical(prisma)),
            ),
            // The charges those contracts give rise to, written once each.
            subscriberLedgerRepository: unless(
                'entitlement.subscriberLedgerRepository',
                provide((prisma) => new PrismaSubscriberLedgerRepository(canonical(prisma))),
            ),
            // The invoices issued from those charges, and their number range.
            subscriptionInvoiceRepository: unless(
                'entitlement.subscriptionInvoiceRepository',
                provide((prisma) => new PrismaSubscriptionInvoiceRepository(canonical(prisma))),
            ),
            subscriptionBundleRepository: provide(
                (prisma) => new PrismaSubscriptionBundleRepository(canonical(prisma)),
            ),
            bundleRepository: provide((prisma) => new PrismaBundleRepository(canonical(prisma))),
        },
        catalog: {
            planRepository: provide((prisma) => new PrismaPlanRepository(prisma, options.schema)),
            bundleRepository: provide((prisma) => new PrismaBundleRepository(canonical(prisma))),
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
            subscriptionNotices: unless(
                'tenantBilling.subscriptionNotices',
                provide((prisma) => new PrismaSubscriptionNoticeRepository(canonical(prisma))),
            ),
            versionRetirements: unless(
                'tenantBilling.versionRetirements',
                provide((prisma) => new PrismaVersionRetirementRepository(canonical(prisma))),
            ),
            bundleVersionRetirements: unless(
                'tenantBilling.bundleVersionRetirements',
                provide((prisma) => new PrismaBundleVersionRetirementRepository(canonical(prisma))),
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
            holdRepository: unless(
                'promo.holdRepository',
                provide((prisma) => new PrismaPromoCodeHoldRepository(canonical(prisma))),
            ),
        },
        payments: {
            paymentEventLog: provide((prisma) => new PrismaPaymentEventLog(prisma)),
            subscriberPaymentMethodRepository: provide(
                (prisma) => new PrismaSubscriberPaymentMethodRepository(canonical(prisma)),
            ),
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
    lifted: (prisma: PrismaLike) => PrismaLike,
): PersistenceProvider<PrismaSuperAdminBootstrapAdapter> | undefined {
    if (hasher === undefined) return undefined;
    const clientIsToken = isInjectionToken(client);
    const hasherIsToken = isInjectionToken(hasher);
    if (clientIsToken && hasherIsToken) {
        return {
            useFactory: (prisma: PrismaLike, h: PasswordHasher) =>
                new PrismaSuperAdminBootstrapAdapter(lifted(prisma), h),
            inject: [client, hasher],
        };
    }
    if (clientIsToken) {
        return {
            useFactory: (prisma: PrismaLike) =>
                new PrismaSuperAdminBootstrapAdapter(lifted(prisma), hasher as PasswordHasher),
            inject: [client],
        };
    }
    if (hasherIsToken) {
        return {
            useFactory: (h: PasswordHasher) =>
                new PrismaSuperAdminBootstrapAdapter(lifted(client), h),
            inject: [hasher],
        };
    }
    return new PrismaSuperAdminBootstrapAdapter(lifted(client), hasher);
}

/** The bypass `rlsIntegration` asks for, or none. */
function rlsBypassOf(
    option: PrismaPersistenceOptions<never>['rlsIntegration'],
): PrismaRlsBypass | undefined {
    if (option instanceof PrismaRlsBypass) return option;
    return option ? new PrismaRlsBypass() : undefined;
}

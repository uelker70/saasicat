import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import { asProvider, type ProviderSpec } from '../core/di.js';
import type {
    SubscriptionContractRepository,
    SubscriptionUsagePort,
    TenantSubscriptionWritePort,
    UsageSnapshotPort,
} from '@saasicat/types';
import {
    SubscriptionContractService,
    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
} from '../subscription-contract/index.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { TenantAdminGuard } from './tenant-admin.guard.js';
import { TenantBillingController } from './tenant-billing.controller.js';
import { PlanChangePreviewService } from './plan-change-preview.service.js';
import { PendingPlanMaterializationService } from './pending-plan-materialization.service.js';
import { SubscriptionContractFreezeService } from './subscription-contract-freeze.service.js';
import {
    CONTRACT_FREEZE_PORT_TOKEN,
    CONTRACT_FREEZE_PROJECT_KEY_TOKEN,
    CONTRACT_FREEZE_SOURCE_PORT_TOKEN,
    type ContractFreezeSourcePort,
} from './contract-freeze.tokens.js';
import {
    SELF_SERVICE_BLOCKED_PLANS_TOKEN,
    type SelfServiceBlockedPlans,
} from './self-service-policy.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    PENDING_PLAN_QUERY_PORT_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
    TENANT_AUTH_GUARDS_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    TRIAL_PROJECTION_PORT_TOKEN,
    USAGE_SNAPSHOT_PORT_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    type AuditContextResolver,
    type PendingPlanQueryPort,
    type TenantIdResolver,
    type TrialProjectionPort,
    type UserEmailResolver,
    type UserIdResolver,
} from './tenant-billing.tokens.js';

// TenantBillingModule — registers the `TenantBillingController` with all
// tenant self-service endpoints (`/billing/entitlement`, `/billing/usage`,
// `/billing/plan/*`, `/billing/cancel`).
//
// Prerequisites:
//   - `PlanCatalogModule.forRoot({ path })` must already be loaded
//     (default `global: true` is sufficient).
//   - `EntitlementModule.forRoot({ ..., global: true })` must be loaded.
//     **Important**: `global: true` is required because
//     `PlanChangePreviewService` (registered internally in TenantBillingModule)
//     injects `EntitlementService` via constructor. Without global visibility
//     the app bootstrap breaks with UndefinedDependencyException.

export interface TenantBillingModuleOptions {
    /**
     * App guards in the order in which they should be executed
     * (e.g. `[JwtAuthGuard, TenantGuard]`). The platform combines them via
     * `ComposedTenantAuthGuard`. At least one guard is mandatory —
     * missing configuration leads to 403 (safe default).
     *
     * Variant 1: array of guard instances (e.g. via factory provider).
     * Variant 2: Pick<FactoryProvider, 'useFactory' | 'inject'> — apps
     * pass their guard classes through via `inject` and the factory builds
     * the array.
     */
    authGuards: ProviderSpec<ReadonlyArray<CanActivate>>;

    /** Adapter to the subscription display form (`GET /billing/usage`). */
    subscriptionUsagePort: ProviderSpec<SubscriptionUsagePort>;

    /** Adapter to usage counters of all `quotaKeys`. */
    usageSnapshotPort: ProviderSpec<UsageSnapshotPort>;

    /** Adapter for plan/add-on mutations (phase C). */
    subscriptionWritePort: ProviderSpec<TenantSubscriptionWritePort>;

    /**
     * Optional adapter that provides the projected new trial end of a change
     * (app trial logic, e.g. carry-over). Without a port,
     * `PlanChangePreviewDto.projectedTrialEndsAt` stays `null`.
     */
    trialProjectionPort?: ProviderSpec<TrialProjectionPort>;

    /**
     * Optional adapter that provides due scheduled plan changes (#19). If it is
     * passed, the module registers the `PendingPlanMaterializationService`
     * (exported) — the consumer triggers it via its own cron. Without a
     * port, the materialization stays disabled (lazy resolution as before).
     */
    pendingPlanQueryPort?: ProviderSpec<PendingPlanQueryPort>;

    /**
     * Optional contract freeze hook (#18). If it is configured, the
     * platform `changePlan` path (non-TRIAL) AND the materialization freeze
     * the agreed service after the plan mutation as a `SubscriptionContract`
     * (analogous to `trialProjectionPort`). Consumer-specific are only `projectKey`
     * + bundle/version data access (`sourcePort`); the contract logic is
     * generic. `subscriptionContractRepository` is the same repo that also goes
     * to `EntitlementModule.forRoot` — the freeze needs it in its own scope.
     */
    contractFreeze?: {
        projectKey: string;
        sourcePort: ProviderSpec<ContractFreezeSourcePort>;
        subscriptionContractRepository: ProviderSpec<SubscriptionContractRepository>;
    };

    /**
     * Plans that are not accepted as target/source via self-service
     * (typically ENTERPRISE → special contract). `null`/undefined = no blocks.
     */
    selfServiceBlockedPlans?: SelfServiceBlockedPlans;

    /** Optional tenant ID resolver. Default: `req.user.tenantId`. */
    tenantIdResolver?: TenantIdResolver;
    /** Optional user ID resolver. Default: `req.user.sub ?? req.user.id`. */
    userIdResolver?: UserIdResolver;
    /**
     * Optional email resolver for the audit log path. Default: `req.user.email`.
     * If the consumer JWT does not include the email, the resolver can
     * return `null` — the audit log then uses `'unknown'`.
     */
    userEmailResolver?: UserEmailResolver;
    /**
     * Optional audit context resolver (session ID / trace ID). Default:
     * `req.headers['x-session-id']` or `'tenant-self-service'`.
     */
    auditContextResolver?: AuditContextResolver;
    /**
     * Modules whose providers must be visible within this module.
     * Typical use case: the app's own `AuthModule`, so that the `JwtAuthGuard`
     * is injectable in the `authGuards` factory. Without this entry NestJS throws
     * `UnknownDependenciesException` for JwtAuthGuard.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /**
     * Additional providers that are registered in the DynamicModule itself —
     * typically: the adapter classes referenced in `inject:[Adapter]` lists
     * (e.g. `PrismaSubscriptionUsagePort`). NestJS 11.1.19
     * resolves factory inject tokens only in the DynamicModule's own scope.
     */
    extraProviders?: Provider[];
    /** Register the module globally — default `false`. */
    global?: boolean;
}

@Module({})
export class TenantBillingModule {
    static forRoot(options: TenantBillingModuleOptions): DynamicModule {
        const providers: Provider[] = [
            asProvider(TENANT_AUTH_GUARDS_TOKEN, options.authGuards),
            asProvider(SUBSCRIPTION_USAGE_PORT_TOKEN, options.subscriptionUsagePort),
            asProvider(USAGE_SNAPSHOT_PORT_TOKEN, options.usageSnapshotPort),
            asProvider(SUBSCRIPTION_WRITE_PORT_TOKEN, options.subscriptionWritePort),
            ComposedTenantAuthGuard,
            TenantAdminGuard,
            PlanChangePreviewService,
        ];

        if (options.selfServiceBlockedPlans) {
            providers.push({
                provide: SELF_SERVICE_BLOCKED_PLANS_TOKEN,
                useValue: options.selfServiceBlockedPlans,
            });
        }
        if (options.trialProjectionPort) {
            providers.push(asProvider(TRIAL_PROJECTION_PORT_TOKEN, options.trialProjectionPort));
        }
        const hasPendingPlanQueryPort = Boolean(options.pendingPlanQueryPort);
        if (options.pendingPlanQueryPort) {
            providers.push(
                asProvider(PENDING_PLAN_QUERY_PORT_TOKEN, options.pendingPlanQueryPort),
                PendingPlanMaterializationService,
            );
        }
        const hasContractFreeze = Boolean(options.contractFreeze);
        if (options.contractFreeze) {
            providers.push(
                {
                    provide: CONTRACT_FREEZE_PROJECT_KEY_TOKEN,
                    useValue: options.contractFreeze.projectKey,
                },
                asProvider(CONTRACT_FREEZE_SOURCE_PORT_TOKEN, options.contractFreeze.sourcePort),
                asProvider(
                    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
                    options.contractFreeze.subscriptionContractRepository,
                ),
                SubscriptionContractService,
                { provide: CONTRACT_FREEZE_PORT_TOKEN, useClass: SubscriptionContractFreezeService },
            );
        }
        if (options.tenantIdResolver) {
            providers.push({
                provide: TENANT_ID_RESOLVER_TOKEN,
                useValue: options.tenantIdResolver,
            });
        }
        if (options.userIdResolver) {
            providers.push({
                provide: USER_ID_RESOLVER_TOKEN,
                useValue: options.userIdResolver,
            });
        }
        if (options.userEmailResolver) {
            providers.push({
                provide: USER_EMAIL_RESOLVER_TOKEN,
                useValue: options.userEmailResolver,
            });
        }
        if (options.auditContextResolver) {
            providers.push({
                provide: AUDIT_CONTEXT_RESOLVER_TOKEN,
                useValue: options.auditContextResolver,
            });
        }
        if (options.extraProviders) providers.push(...options.extraProviders);

        return {
            module: TenantBillingModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers: [TenantBillingController],
            providers,
            exports: [
                ComposedTenantAuthGuard,
                TenantAdminGuard,
                PlanChangePreviewService,
                SUBSCRIPTION_USAGE_PORT_TOKEN,
                USAGE_SNAPSHOT_PORT_TOKEN,
                SUBSCRIPTION_WRITE_PORT_TOKEN,
                ...(hasPendingPlanQueryPort ? [PendingPlanMaterializationService] : []),
                ...(hasContractFreeze ? [CONTRACT_FREEZE_PORT_TOKEN] : []),
            ],
        };
    }
}

// Re-export for consumers that want to register individual guard classes.
export type { Type as NestType };

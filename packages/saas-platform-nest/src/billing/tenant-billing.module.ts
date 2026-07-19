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

// TenantBillingModule — registriert den `TenantBillingController` mit allen
// Tenant-Self-Service-Endpoints (`/billing/entitlement`, `/billing/usage`,
// `/billing/plan/*`, `/billing/cancel`).
//
// Voraussetzungen:
//   - `PlanCatalogModule.forRoot({ path })` muss bereits geladen sein
//     (Default `global: true` reicht).
//   - `EntitlementModule.forRoot({ ..., global: true })` muss geladen sein.
//     **Wichtig**: `global: true` ist erforderlich, weil
//     `PlanChangePreviewService` (intern in TenantBillingModule registriert)
//     `EntitlementService` per Constructor injectet. Ohne globale Sichtbarkeit
//     bricht der App-Bootstrap mit UndefinedDependencyException.

export interface TenantBillingModuleOptions {
    /**
     * App-Guards in der Reihenfolge, in der sie ausgeführt werden sollen
     * (z. B. `[JwtAuthGuard, TenantGuard]`). Plattform fasst sie über
     * `ComposedTenantAuthGuard` zusammen. Mindestens ein Guard ist Pflicht —
     * fehlende Konfiguration führt zu 403 (sicherer Default).
     *
     * Variante 1: Array von Guard-Instanzen (z. B. via Factory-Provider).
     * Variante 2: Pick<FactoryProvider, 'useFactory' | 'inject'> — Apps
     * reichen ihre Guard-Klassen via `inject` durch und der Factory baut
     * das Array.
     */
    authGuards: ProviderSpec<ReadonlyArray<CanActivate>>;

    /** Adapter zur Subscription-Display-Form (`GET /billing/usage`). */
    subscriptionUsagePort: ProviderSpec<SubscriptionUsagePort>;

    /** Adapter zu Verbrauchszählern aller `quotaKeys`. */
    usageSnapshotPort: ProviderSpec<UsageSnapshotPort>;

    /** Adapter für Plan-/Add-on-Mutationen (Phase C). */
    subscriptionWritePort: ProviderSpec<TenantSubscriptionWritePort>;

    /**
     * Optionaler Adapter, der das projizierte neue Trial-Ende eines Wechsels
     * liefert (App-Trial-Logik, z. B. Carry-over). Ohne Port bleibt
     * `PlanChangePreviewDto.projectedTrialEndsAt` `null`.
     */
    trialProjectionPort?: ProviderSpec<TrialProjectionPort>;

    /**
     * Optionaler Adapter, der fällige geplante Plan-Wechsel liefert (#19). Wird
     * er übergeben, registriert das Modul die `PendingPlanMaterializationService`
     * (exportiert) — der Konsument triggert sie über einen eigenen Cron. Ohne
     * Port bleibt die Materialisierung deaktiviert (Lazy-Resolution wie bisher).
     */
    pendingPlanQueryPort?: ProviderSpec<PendingPlanQueryPort>;

    /**
     * Optionaler Contract-Freeze-Hook (#18). Wird er konfiguriert, friert der
     * Plattform-`changePlan`-Pfad (nicht-TRIAL) UND die Materialisierung den
     * vereinbarten Dienst nach der Plan-Mutation als `SubscriptionContract` ein
     * (analog `trialProjectionPort`). Konsumentenspezifisch sind nur `projectKey`
     * + Bundle-/Versions-Datenzugriff (`sourcePort`); die Contract-Logik ist
     * generisch. `subscriptionContractRepository` ist dasselbe Repo, das auch an
     * `EntitlementModule.forRoot` geht — der Freeze braucht es im eigenen Scope.
     */
    contractFreeze?: {
        projectKey: string;
        sourcePort: ProviderSpec<ContractFreezeSourcePort>;
        subscriptionContractRepository: ProviderSpec<SubscriptionContractRepository>;
    };

    /**
     * Pläne, die nicht per Self-Service als Ziel/Quelle akzeptiert werden
     * (typisch ENTERPRISE → Sondervertrag). `null`/undefined = keine Blocks.
     */
    selfServiceBlockedPlans?: SelfServiceBlockedPlans;

    /** Optionaler Tenant-ID-Resolver. Default: `req.user.tenantId`. */
    tenantIdResolver?: TenantIdResolver;
    /** Optionaler User-ID-Resolver. Default: `req.user.sub ?? req.user.id`. */
    userIdResolver?: UserIdResolver;
    /**
     * Optionaler Email-Resolver für den Audit-Log-Pfad. Default: `req.user.email`.
     * Wenn der Konsumenten-JWT die Email nicht mitliefert, kann der Resolver
     * `null` zurückgeben — der Audit-Log nimmt dann `'unknown'`.
     */
    userEmailResolver?: UserEmailResolver;
    /**
     * Optionaler Audit-Kontext-Resolver (Session-ID / Trace-ID). Default:
     * `req.headers['x-session-id']` oder `'tenant-self-service'`.
     */
    auditContextResolver?: AuditContextResolver;
    /**
     * Module, deren Provider innerhalb dieses Moduls sichtbar sein müssen.
     * Typischer Use-Case: das App-eigene `AuthModule`, damit der `JwtAuthGuard`
     * im `authGuards`-Factory injectable ist. Ohne diesen Eintrag wirft NestJS
     * `UnknownDependenciesException` für JwtAuthGuard.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /**
     * Zusätzliche Provider, die im DynamicModule selbst registriert werden —
     * typisch: die Adapter-Klassen, die in `inject:[Adapter]`-Listen
     * referenziert werden (z. B. `PrismaSubscriptionUsagePort`). NestJS 11.1.19
     * resolved Factory-Inject-Tokens nur im DynamicModule-eigenen Scope.
     */
    extraProviders?: Provider[];
    /** Modul global registrieren — Default `false`. */
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

// Re-Export für Konsumenten, die einzelne Guard-Klassen registrieren wollen.
export type { Type as NestType };

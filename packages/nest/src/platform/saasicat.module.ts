// SaaSiCatModule — the assembler.
//
// The base path bundles PlanCatalog, Discovery, Admin and AdminManifest; the
// standard options add Entitlement, Catalog, PublicCatalog, TenantBilling,
// SubscriptionBundles, Setup, AdminStats, CheckoutOffer and
// SubscriptionContract, without the consumer writing a forwarding module for
// each.
//
// Goal: consumer code describes product-specific choices while a persistence
// bundle supplies standard repositories. Individual modules remain available
// as the escape hatch — whoever needs more control (multiple manifest
// controllers, differing guards per endpoint, custom catalog adapters) keeps
// using them directly. This is a convenience, not a requirement.
//
// What this file does NOT contain, and where it went:
//
//   compose/          one file per feature — what it mounts, and from which
//                     options and persistence slice. Ordered in
//                     `compose/index.ts`, because tenant billing resolves what
//                     the bundles read.
//   validation/       the fifteen configuration rules, as data, reported all
//                     at once instead of one throw per boot.
//   module-options.ts the option types, so the rules can be stated over them
//                     without importing this file.
//
// The `forRoot` below is what is left once those are elsewhere: normalise the
// adapters, check the configuration, assemble.

import { type DynamicModule, Logger, Module, type Provider } from '@nestjs/common';
import type { AuditPort, MfaPort, RlsBypassPort } from '@saasicat/core';

import { type ProviderSpec } from '../core/di.js';
import { AdminManifestService } from '../admin/admin-manifest.service.js';
import { DiscoveryModule as NestDiscoveryModule } from '@nestjs/core';

import {
    ENFORCEMENT_CHAIN_STATE_TOKEN,
    EnforcementChainCheck,
    type EnforcementChainState,
} from './enforcement-chain.check.js';

export * from './module-options.js';
import { assertConfiguration } from './validation/validate.js';
import { composeFeatures, type CompositionContext } from './compose/index.js';
import { composeBaseModules, composePlanCatalog, resolveAppInfo } from './compose/base.js';
import { composeModuleExports } from './compose/module-exports.js';
import { composeTenantManifest } from './compose/tenant-manifest.js';
import { composeEnforcementRuntime, resolvePlanResolution } from './compose/enforcement-runtime.js';
import {
    STANDARD_MANIFEST_REGISTRATION_TOKEN,
    buildStandardManifestContribution,
} from './compose/manifest.js';
import type { SaaSiCatAdapters, SaaSiCatModuleOptions } from './module-options.js';

/**
 * Boot-time diagnostics for configurations that leave enforcement inert.
 *
 * These conditions do not break anything visibly — they make `@RequireFeature`
 * and `@EnforceQuota` stop blocking, so annotated routes serve everyone and
 * every quota reads as unlimited. Without a log line the first signal is a
 * customer using a feature they never bought.
 */
const PLATFORM_LOGGER = new Logger('SaaSiCat');

function enforcementChainState(state: EnforcementChainState): Provider {
    return { provide: ENFORCEMENT_CHAIN_STATE_TOKEN, useValue: state };
}

/**
 * Bundles the complete standard SaaSiCat backend stack into a single
 * `forRoot({...})` call. Reduces AppModule boilerplate and eliminates the
 * ordering trap.
 *
 * Quickstart path (Prisma + PostgreSQL on the canonical schema):
 *
 * ```ts
 * SaaSiCatModule.forRoot({
 *     planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
 *     controller: { guards: [JwtAuthGuard] },
 *     imports: [AuthModule],
 *     persistence: prismaPersistence({ client: PrismaService }), // @saasicat/adapter-prisma
 * })
 * ```
 *
 * Individual `adapters` entries stay supported (custom schema / other ORM)
 * and override bundle slices field by field.
 */
@Module({})
export class SaaSiCatModule {
    static forRoot(options: SaaSiCatModuleOptions): DynamicModule {
        const explicit = options.adapters ?? ({} as SaaSiCatAdapters);
        const persistence = options.persistence;
        const catalogConfig = options.catalog || null;
        const tenantBillingConfig = options.tenantBilling || null;
        const subscriptionBundlesConfig = options.subscriptionBundles || null;
        const adminResourcesConfig = options.adminResources || null;
        const promoCodesConfig = options.promoCodes || null;
        const requiresFullEntitlement = Boolean(
            options.entitlement || tenantBillingConfig || subscriptionBundlesConfig,
        );
        // Explicit adapter entries override the bundle slices.
        const adapters: SaaSiCatAdapters = {
            mfa: explicit.mfa ?? persistence?.core.mfa,
            audit: explicit.audit ?? persistence?.core.audit,
            rlsBypass: explicit.rlsBypass ?? persistence?.core.rlsBypass,
            appliedSettings: explicit.appliedSettings ?? persistence?.core.appliedSettings,
            email: explicit.email,
            planCatalogReadSink: explicit.planCatalogReadSink ?? persistence?.planCatalogReadSink,
            planResolver: explicit.planResolver,
            subscriptionRepository:
                explicit.subscriptionRepository ?? persistence?.entitlement?.subscriptionRepository,
            planVersionRepository:
                explicit.planVersionRepository ?? persistence?.entitlement?.planVersionRepository,
            transactionRunner: explicit.transactionRunner ?? persistence?.core.transactionRunner,
        } as SaaSiCatAdapters;

        // Every rule at once, rather than one throw per boot.
        //
        // The rules themselves are in `validation/rules.ts` — as data, so an
        // integrator gets the complete list of what is missing instead of
        // discovering it one restart at a time, and so each one can carry the
        // link to its own documentation.
        assertConfiguration({ options, adapters });

        // Non-null after the check above — AdminModule requires them.
        const mfaPort = adapters.mfa as ProviderSpec<MfaPort>;
        const auditPort = adapters.audit as ProviderSpec<AuditPort>;
        const rlsBypassPort = adapters.rlsBypass as ProviderSpec<RlsBypassPort>;

        const appInfo = resolveAppInfo(options);
        const imports: NonNullable<DynamicModule['imports']> = [
            // Make injected client/auth providers visible to the high-level
            // module's own quota providers and automatic plan resolver too.
            ...(options.imports ?? []),
            composePlanCatalog(options, adapters.planCatalogReadSink),
            ...composeBaseModules(options, appInfo, {
                mfaPort,
                auditPort,
                rlsBypassPort,
                appliedSettingsPort: adapters.appliedSettings,
                emailPort: adapters.email,
            }),
        ];

        // Every enabled feature, in composer order.
        //
        // What used to be twelve `if (config) imports.push(XModule.forRoot(…))`
        // blocks is one file per feature under `compose/`. The order is not
        // incidental: tenant billing resolves the auth guards and the usage
        // port that the bundles read, and `compose/index.ts` says so.
        const composition: CompositionContext = {
            options,
            adapters,
            persistence,
            appInfo,
            requiresFullEntitlement,
            shared: { quotaProvidersHostedByTenantBilling: false },
        };
        imports.push(...composeFeatures(composition));

        // ------------------------------------------------------------------
        // Lightweight static-entitlement stack: auto-wire FeatureGuard +
        // EnforceQuotaInterceptor so that `@RequireFeature` and
        // `@EnforceQuota` take effect right after the mega-module import.
        // Condition: PlanResolver or defaultPlanId.
        // ------------------------------------------------------------------
        const lightweightProviders: Provider[] = [];
        const lightweightExports: NonNullable<DynamicModule['exports']> = [];
        if (options.autoManifest !== false) {
            const contribution = buildStandardManifestContribution(
                catalogConfig,
                adminResourcesConfig,
                promoCodesConfig,
            );
            lightweightProviders.push({
                provide: STANDARD_MANIFEST_REGISTRATION_TOKEN,
                useFactory: (manifest: AdminManifestService) => {
                    manifest.register(contribution);
                    return contribution;
                },
                inject: [AdminManifestService],
            });
        }
        // The static enforcement stack — what makes `@RequireFeature` and
        // `@EnforceQuota` act. Empty when nothing can resolve a plan.
        const resolution = resolvePlanResolution(composition);
        const runtime = composeEnforcementRuntime(composition, resolution);
        lightweightProviders.push(...runtime.providers);
        lightweightExports.push(...runtime.exports);

        // The static entitlement stack is inert here, but that alone is not the
        // finding — an application on the V3 path resolves entitlements through
        // `EntitlementService` and binds `FeatureGuard` itself, and telling it
        // that its decorators do nothing would be a warning at a correct
        // configuration. So the condition is the whole chain, not the static
        // half of it.
        //
        // Whether even that is a mistake depends on something `forRoot` cannot
        // see: whether any route is annotated at all. So this says what is true
        // here, and `EnforcementChainCheck` decides after bootstrap — an
        // annotation that cannot act takes the boot down, and an application
        // with none of them carries on with this line as its only signal.
        if (!resolution.available && !requiresFullEntitlement) {
            PLATFORM_LOGGER.warn(
                'No plan resolver configured — @RequireFeature and @EnforceQuota are INERT. ' +
                    'The platform registered neither StaticFeatureGuard nor EnforceQuotaInterceptor, ' +
                    'so every annotated route serves unlicensed traffic and every quota is unlimited. ' +
                    'Set one of: adapters.planResolver, defaultPlanId, or tenantBilling.',
            );
        }

        // The enforcement-chain check, registered for every configuration.
        //
        // Not per branch, and that is the correction: registering it only where
        // it seemed needed meant deciding in advance which shapes can be wrong,
        // in the file that produces those shapes. It is cheap — one bootstrap
        // hook that walks the controllers once — and it is told what it cannot
        // see rather than inferring it.
        //
        // Two flags, because there are two runtimes and only one of them
        // follows the V3 path. `featureEnforcementActive` is deliberately
        // broader than the static stack: an app on the V3 path (`entitlement`,
        // `tenantBilling`) resolves entitlements through `EntitlementService`
        // and binds `FeatureGuard` from `@saasicat/nest/billing` itself, so
        // treating that as inert would refuse to boot a correctly wired
        // application. Quotas do not come with it — `EnforceQuotaInterceptor`
        // is registered by `composeEnforcementRuntime`, which returns nothing
        // without a plan resolver. One flag for both let a V3 app boot with
        // every `@EnforceQuota` reading as unlimited.
        if (options.enforcementChainCheck !== false) {
            lightweightProviders.push(
                EnforcementChainCheck,
                enforcementChainState({
                    featureEnforcementActive: resolution.available || requiresFullEntitlement,
                    quotaEnforcementActive: resolution.available,
                    globalGuardBound: resolution.available && options.globalFeatureGuard !== false,
                    // Whether the OPTION unbound it, as opposed to this simply
                    // being a path where the platform binds none. The message
                    // names the true cause, and an application that never set
                    // the option is not told to look for it.
                    globalGuardOptedOut: options.globalFeatureGuard === false,
                }),
            );
        }
        // It walks the controllers, so it needs Nest's own discovery
        // primitives. Imported here rather than relied upon: the platform's own
        // DiscoveryModule can be switched off, and a check that cannot be
        // constructed takes the whole boot down with it.
        if (options.enforcementChainCheck !== false) imports.push(NestDiscoveryModule);

        const tenantManifest = composeTenantManifest(composition);
        lightweightProviders.push(...tenantManifest.providers);
        lightweightExports.push(...tenantManifest.exports);

        return {
            module: SaaSiCatModule,
            imports,
            providers: lightweightProviders,
            controllers: tenantManifest.controllers,
            exports: composeModuleExports(composition, lightweightExports),
            global: true,
        };
    }
}

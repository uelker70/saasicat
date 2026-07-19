// SubscriptionBundleModule — DI-Wrapper für SubscriptionBundlesService.
//
// Konsument reicht seine Adapter durch und konfiguriert ggf. die
// Default-Mindestlaufzeit:
//
// ```ts
// SubscriptionBundleModule.forRoot({
//   subscriptionBundleRepository: {
//     useFactory: (r: PrismaSubscriptionBundleRepository) => r,
//     inject: [PrismaSubscriptionBundleRepository],
//   },
//   bundleRepository: { useExisting: BUNDLE_REPOSITORY_TOKEN },
//   defaultMinimumTermMonths: 12,
//   imports: [PrismaModule, CatalogModule],
// })
// ```
//
// Hinweis: `BUNDLE_REPOSITORY_TOKEN` wird üblicherweise vom CatalogModule
// schon registriert und exportiert — dann reicht `imports: [CatalogModule]`
// im Konsumenten ohne eigenes `bundleRepository`-Forwarding.

import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type {
    BundleRepository,
    SubscriptionBundleRepository,
    SubscriptionUsagePort,
} from '@saasicat/types';

import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/tokens.js';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import {
    SELF_SERVICE_BLOCKED_BUNDLES_TOKEN,
    type SelfServiceBlockedBundles,
} from './self-service-policy.js';
import { SubscriptionBundlePreviewService } from './subscription-bundle-preview.service.js';
import {
    SubscriptionBundlesService,
    type SubscriptionBundleConfig,
} from './subscription-bundles.service.js';
import {
    SUBSCRIPTION_BUNDLE_CONFIG_TOKEN,
    SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN,
} from './subscription-bundles.tokens.js';
import {
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    TENANT_AUTH_GUARDS_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    type TenantIdResolver,
} from './tenant-billing.tokens.js';
import { buildTenantSubscriptionBundlesController } from './tenant-subscription-bundles.controller.js';

export interface SubscriptionBundleControllerOptions {
    extraGuards?: Array<Type<CanActivate>>;
    /**
     * Auth-Guard-Liste analog `TenantBillingModule.forRoot.authGuards`.
     * Ohne diese Liste blockiert `ComposedTenantAuthGuard` fail-closed.
     */
    authGuards?: ProviderSpec<ReadonlyArray<CanActivate>>;
    /**
     * Usage-Port für Subscription-Lookup und aktuelle Plan-Kompatibilität.
     * Wenn nicht gesetzt, muss ein importiertes Modul den Token exportieren.
     */
    subscriptionUsagePort?: ProviderSpec<SubscriptionUsagePort>;
    /** Optionaler Tenant-ID-Resolver. Default: `req.user.tenantId`. */
    tenantIdResolver?: TenantIdResolver;
}

export interface SubscriptionBundleModuleOptions {
    subscriptionBundleRepository: ProviderSpec<SubscriptionBundleRepository>;
    /**
     * Optional — wenn weggelassen, wird `BUNDLE_REPOSITORY_TOKEN` per
     * Default-Inject aus dem DI-Scope erwartet (typisch via importiertem
     * `CatalogModule`).
     */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /** Default Mindestlaufzeit (Monate). Default = 12. */
    defaultMinimumTermMonths?: number;
    /**
     * Self-Service-Policy (#37): Bundles, die nur per Vertrieb buchbar
     * sind. Greift in `addBundleToSubscription` (422 BUNDLE_NOT_SELF_SERVICE)
     * und im Preview (Blocker).
     */
    selfServiceBlockedBundles?: SelfServiceBlockedBundles;
    /**
     * Wenn gesetzt: Tenant-Self-Service-Controller wird unter
     * `/billing/subscription-bundles` gemountet (GET/POST/DELETE). Die
     * `extraGuards` werden zusätzlich zum Plattform-Default
     * `ComposedTenantAuthGuard` angewendet (Rollen-/MFA-Guards).
     *
     * Voraussetzung: der Konsument hat `TenantBillingModule` bereits
     * registriert — der Controller braucht `SUBSCRIPTION_USAGE_PORT_TOKEN`
     * + `TENANT_ID_RESOLVER_TOKEN` im selben DI-Scope.
     */
    controller?: SubscriptionBundleControllerOptions;
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    global?: boolean;
}

@Module({})
export class SubscriptionBundleModule {
    static forRoot(options: SubscriptionBundleModuleOptions): DynamicModule {
        const providers: Provider[] = [
            asProvider(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN, options.subscriptionBundleRepository),
            ...(options.bundleRepository
                ? [asProvider(BUNDLE_REPOSITORY_TOKEN, options.bundleRepository)]
                : []),
            {
                provide: SUBSCRIPTION_BUNDLE_CONFIG_TOKEN,
                useValue: {
                    defaultMinimumTermMonths: options.defaultMinimumTermMonths ?? 12,
                } satisfies SubscriptionBundleConfig,
            },
            ...(options.selfServiceBlockedBundles
                ? [
                      {
                          provide: SELF_SERVICE_BLOCKED_BUNDLES_TOKEN,
                          useValue: options.selfServiceBlockedBundles,
                      },
                  ]
                : []),
            SubscriptionBundlesService,
            SubscriptionBundlePreviewService,
            ...(options.extraProviders ?? []),
        ];

        const controllers: Type[] = [];
        if (options.controller) {
            providers.push(ComposedTenantAuthGuard);
            if (options.controller.authGuards) {
                providers.push(asProvider(TENANT_AUTH_GUARDS_TOKEN, options.controller.authGuards));
            }
            if (options.controller.subscriptionUsagePort) {
                providers.push(
                    asProvider(
                        SUBSCRIPTION_USAGE_PORT_TOKEN,
                        options.controller.subscriptionUsagePort,
                    ),
                );
            }
            providers.push({
                provide: TENANT_ID_RESOLVER_TOKEN,
                useValue:
                    options.controller.tenantIdResolver ??
                    ((req: unknown) =>
                        (req as { user?: { tenantId?: string | null } }).user?.tenantId ?? null),
            });
            controllers.push(
                buildTenantSubscriptionBundlesController(options.controller.extraGuards ?? []),
            );
        }

        return {
            module: SubscriptionBundleModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers,
            providers,
            exports: [
                SubscriptionBundlesService,
                SubscriptionBundlePreviewService,
                SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN,
            ],
        };
    }
}

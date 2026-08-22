// SubscriptionBundleModule — DI wrapper for SubscriptionBundlesService.
//
// The consumer passes its adapters through and optionally configures the
// default minimum term:
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
// Note: `BUNDLE_REPOSITORY_TOKEN` is usually already registered and exported
// by the CatalogModule — then `imports: [CatalogModule]` suffices
// in the consumer without its own `bundleRepository` forwarding.

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
     * Auth guard list analogous to `TenantBillingModule.forRoot.authGuards`.
     * Without this list, `ComposedTenantAuthGuard` blocks fail-closed.
     */
    authGuards?: ProviderSpec<ReadonlyArray<CanActivate>>;
    /**
     * Usage port for subscription lookup and current plan compatibility.
     * If not set, an imported module must export the token.
     */
    subscriptionUsagePort?: ProviderSpec<SubscriptionUsagePort>;
    /** Optional tenant-ID resolver. Default: `req.user.tenantId`. */
    tenantIdResolver?: TenantIdResolver;
}

export interface SubscriptionBundleModuleOptions {
    subscriptionBundleRepository: ProviderSpec<SubscriptionBundleRepository>;
    /**
     * Optional — if omitted, `BUNDLE_REPOSITORY_TOKEN` is expected via
     * default inject from the DI scope (typically via an imported
     * `CatalogModule`).
     */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /** Default minimum term (months). Default = 12. */
    defaultMinimumTermMonths?: number;
    /**
     * Self-service policy (#37): bundles that are only bookable via sales.
     * Applies in `addBundleToSubscription` (422 BUNDLE_NOT_SELF_SERVICE)
     * and in the preview (blocker).
     */
    selfServiceBlockedBundles?: SelfServiceBlockedBundles;
    /**
     * If set: the tenant self-service controller is mounted at
     * `/billing/subscription-bundles` (GET/POST/DELETE). The
     * `extraGuards` are applied in addition to the platform default
     * `ComposedTenantAuthGuard` (role/MFA guards).
     *
     * Prerequisite: the consumer has already registered `TenantBillingModule`
     * — the controller needs `SUBSCRIPTION_USAGE_PORT_TOKEN`
     * + `TENANT_ID_RESOLVER_TOKEN` in the same DI scope.
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

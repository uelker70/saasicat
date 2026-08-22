// The static enforcement stack: what makes `@RequireFeature` and
// `@EnforceQuota` act.
//
// A separate concern from the feature composers, and the reason it is its own
// file: those add MODULES, this adds providers into the platform module's own
// scope — a plan resolver, the entitlement service, the guard, the interceptor
// and the quota registry. Which of the three resolvers is bound is the one
// decision in `forRoot` that is genuinely conditional on three inputs at once,
// and it was in the middle of six hundred lines.

import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { DynamicModule, Provider } from '@nestjs/common';
import type { QuotaProvider, SubscriptionRepository } from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../../core/di.js';
import { EnforceQuotaInterceptor, QUOTA_PROVIDERS_TOKEN } from '../enforce-quota.interceptor.js';
import { PLAN_RESOLVER_PORT_TOKEN, type PlanResolverPort } from '../plan-resolver.port.js';
import { StaticPlanResolver } from '../plan-resolver.port.js';
import { StaticEntitlementService } from '../static-entitlement.service.js';
import { StaticFeatureGuard } from '../static-feature.guard.js';
import { SubscriptionPlanResolver } from '../subscription-plan-resolver.js';
import { PLATFORM_SUBSCRIPTION_REPOSITORY_TOKEN } from './manifest.js';

import type { CompositionContext } from './context.js';

/** How a tenant is resolved to a plan, or that nothing can. */
export interface PlanResolution {
    /** An adapter the app bound directly. */
    readonly explicit: boolean;
    /** Derivable from the subscription repository, via tenant billing. */
    readonly viaSubscriptions: boolean;
    /** A fixed `defaultPlanId` for apps with one plan. */
    readonly fallback: boolean;
    /** Whether anything above can answer. */
    readonly available: boolean;
}

export function resolvePlanResolution(ctx: CompositionContext): PlanResolution {
    const explicit = !!ctx.adapters.planResolver;
    const viaSubscriptions = Boolean(
        ctx.options.tenantBilling && ctx.adapters.subscriptionRepository,
    );
    const fallback = !!ctx.options.defaultPlanId;
    return {
        explicit,
        viaSubscriptions,
        fallback,
        available: explicit || viaSubscriptions || fallback,
    };
}

export interface EnforcementRuntime {
    readonly providers: Provider[];
    readonly exports: NonNullable<DynamicModule['exports']>;
}

/**
 * The providers and exports of the static enforcement stack.
 *
 * Empty when nothing can resolve a plan: registering a guard with no
 * entitlement behind it would answer every request the same way, which is
 * worse than not registering it. `EnforcementChainCheck` is what notices that
 * state, after bootstrap, where the annotated routes are visible.
 */
export function composeEnforcementRuntime(
    ctx: CompositionContext,
    resolution: PlanResolution,
): EnforcementRuntime {
    if (!resolution.available) return { providers: [], exports: [] };

    const { options, adapters, shared } = ctx;
    const providers: Provider[] = [];

    // The subscription repository is bound under the platform's own token so
    // the derived resolver can inject it without the app having registered it.
    if (resolution.viaSubscriptions && !resolution.explicit) {
        providers.push(
            asProvider(
                PLATFORM_SUBSCRIPTION_REPOSITORY_TOKEN,
                adapters.subscriptionRepository as ProviderSpec<SubscriptionRepository>,
            ),
        );
    }

    providers.push(
        planResolverProvider(ctx, resolution),
        StaticEntitlementService,
        StaticFeatureGuard,
        EnforceQuotaInterceptor,
        // Tenant billing registers them in its own scope when it is on;
        // registering them again here would be two instances of one counter.
        ...(shared.quotaProvidersHostedByTenantBilling ? [] : (options.quotaProviders ?? [])),
        {
            provide: QUOTA_PROVIDERS_TOKEN,
            useFactory: (...quotas: QuotaProvider[]) => quotas,
            inject: options.quotaProviders ?? [],
        },
        ...(options.globalFeatureGuard === false
            ? []
            : [{ provide: APP_GUARD, useExisting: StaticFeatureGuard }]),
        // The interceptor stays global either way: interceptors run after all
        // guards, so it sees the authenticated request even when the app binds
        // its own guard chain.
        { provide: APP_INTERCEPTOR, useExisting: EnforceQuotaInterceptor },
    );

    return {
        providers,
        exports: [
            PLAN_RESOLVER_PORT_TOKEN,
            StaticEntitlementService,
            StaticFeatureGuard,
            EnforceQuotaInterceptor,
            QUOTA_PROVIDERS_TOKEN,
        ],
    };
}

/** The one of three resolvers this configuration implies. */
function planResolverProvider(ctx: CompositionContext, resolution: PlanResolution): Provider {
    if (resolution.explicit) {
        return asProvider(
            PLAN_RESOLVER_PORT_TOKEN,
            ctx.adapters.planResolver as ProviderSpec<PlanResolverPort>,
        );
    }
    if (resolution.viaSubscriptions) {
        return {
            provide: PLAN_RESOLVER_PORT_TOKEN,
            useFactory: (subscriptions: SubscriptionRepository) =>
                new SubscriptionPlanResolver(subscriptions),
            inject: [PLATFORM_SUBSCRIPTION_REPOSITORY_TOKEN],
        };
    }
    return {
        provide: PLAN_RESOLVER_PORT_TOKEN,
        useValue: new StaticPlanResolver(ctx.options.defaultPlanId as string),
    };
}

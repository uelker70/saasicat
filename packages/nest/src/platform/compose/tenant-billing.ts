import type { DynamicModule } from '@nestjs/common';
import type {
    SubscriptionBundleRepository,
    SubscriptionUsagePort,
    TenantSubscriptionWritePort,
} from '@saasicat/core';

import { SubscriptionBundleModule } from '../../billing/subscription-bundles.module.js';
import { TenantBillingModule } from '../../billing/tenant-billing.module.js';
import type { ProviderSpec } from '../../core/di.js';
import { normalizeTenantAuthGuards, quotaUsageSnapshotProvider } from './tenant-bindings.js';

import { optionsOf, type CompositionContext } from './context.js';

/**
 * The tenant's own billing surface — and the only composer that writes to
 * `ctx.shared`.
 *
 * Three things it resolves are needed by whoever runs after it: the normalised
 * auth guards, the usage port, and whether it took the app's quota providers
 * into its own scope. Registering those a second time elsewhere would give two
 * instances of one `QuotaProvider`, which is two counters over the same rows.
 */
export function composeTenantBilling(ctx: CompositionContext): DynamicModule[] {
    const config = ctx.options.tenantBilling;
    if (!config) return [];

    const tenantSlice = ctx.persistence?.tenantBilling;
    const {
        authGuards,
        subscriptionUsagePort,
        usageSnapshotPort,
        subscriptionWritePort,
        imports: tenantImports,
        extraProviders,
        extraExports,
        ...tenantOptions
    } = config;
    const quotaProviders = ctx.options.quotaProviders ?? [];

    ctx.shared.quotaProvidersHostedByTenantBilling = quotaProviders.length > 0;
    ctx.shared.authGuards = normalizeTenantAuthGuards(authGuards);
    ctx.shared.subscriptionUsagePort = subscriptionUsagePort ?? tenantSlice?.subscriptionUsagePort;

    return [
        TenantBillingModule.forRoot({
            ...tenantOptions,
            authGuards: ctx.shared.authGuards,
            // The same adapter `SubscriptionBundleModule` gets. That module
            // exports the token, but it is a sibling import here rather than an
            // ancestor, so its exports never reach this module's providers —
            // and the plan-change rule that reads bookings would resolve to
            // "none" and allow the move it exists to refuse.
            subscriptionBundleRepository: ctx.persistence?.entitlement
                ?.subscriptionBundleRepository as
                ProviderSpec<SubscriptionBundleRepository> | undefined,
            subscriptionUsagePort: ctx.shared
                .subscriptionUsagePort as ProviderSpec<SubscriptionUsagePort>,
            usageSnapshotPort:
                usageSnapshotPort ??
                tenantSlice?.usageSnapshotPort ??
                quotaUsageSnapshotProvider(quotaProviders),
            subscriptionWritePort:
                subscriptionWritePort ??
                (tenantSlice?.subscriptionWritePort as ProviderSpec<TenantSubscriptionWritePort>),
            imports: tenantImports ?? ctx.options.imports,
            extraProviders: [...quotaProviders, ...(extraProviders ?? [])],
            extraExports: [...quotaProviders, ...(extraExports ?? [])],
        }),
    ];
}

/**
 * Bundles a tenant can book on top of its plan.
 *
 * Runs after `composeTenantBilling` and reads what it resolved — the two share
 * one authentication chain and one usage port on purpose, so a tenant sees the
 * same numbers on both screens.
 */
export function composeSubscriptionBundles(ctx: CompositionContext): DynamicModule[] {
    if (!ctx.options.subscriptionBundles) return [];
    const config = optionsOf(ctx.options.subscriptionBundles);
    const { controller, imports: bundleImports, extraProviders, ...bundleOptions } = config;

    return [
        SubscriptionBundleModule.forRoot({
            ...bundleOptions,
            subscriptionBundleRepository: ctx.persistence?.entitlement
                ?.subscriptionBundleRepository as ProviderSpec<SubscriptionBundleRepository>,
            bundleRepository: ctx.persistence?.catalog?.bundleRepository,
            controller:
                controller === false
                    ? undefined
                    : {
                          ...(controller ?? {}),
                          authGuards: ctx.shared.authGuards,
                          subscriptionUsagePort: ctx.shared.subscriptionUsagePort,
                      },
            // Falls back to the tenant-billing imports before the shared ones,
            // because the two controllers usually resolve the same app
            // providers and an app that scoped them for one meant both.
            imports:
                bundleImports ??
                optionsOf(ctx.options.tenantBilling).imports ??
                ctx.options.imports,
            extraProviders,
        }),
    ];
}

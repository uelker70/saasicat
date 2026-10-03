import type { DynamicModule } from '@nestjs/common';
import type {
    BundleRepository,
    SubscriptionBundleRepository,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    TenantSubscriptionWritePort,
    TransactionRunner,
} from '@saasicat/core';

import { SubscriptionBundleModule } from '../../billing/subscription-bundles.module.js';
import { TenantBillingModule } from '../../billing/tenant-billing.module.js';
import type { ProviderSpec } from '../../core/di.js';
import { normalizeTenantAuthGuards, quotaUsageSnapshotProvider } from './tenant-bindings.js';

import { resolveBundleRepository } from './bundle-repository-source.js';
import { optionsOf, type CompositionContext } from './context.js';
import { versionRetirementsOf } from './version-retirement.js';

/**
 * The tenant's own billing surface.
 *
 * Four things it resolves are needed by whoever runs after it: the normalised
 * auth guards, the usage port, whether it took the app's quota providers into
 * its own scope, and the module itself. Registering those a second time
 * elsewhere would give two instances of one `QuotaProvider`, which is two
 * counters over the same rows.
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
        versionNotices,
        imports: tenantImports,
        extraProviders,
        extraExports,
        ...tenantOptions
    } = config;
    const quotaProviders = ctx.options.quotaProviders ?? [];

    ctx.shared.quotaProvidersHostedByTenantBilling = quotaProviders.length > 0;
    ctx.shared.authGuards = normalizeTenantAuthGuards(authGuards);
    ctx.shared.subscriptionUsagePort = subscriptionUsagePort ?? tenantSlice?.subscriptionUsagePort;

    ctx.shared.tenantBillingModule = TenantBillingModule.forRoot({
        ...tenantOptions,
        authGuards: ctx.shared.authGuards,
        // The same adapter `SubscriptionBundleModule` gets. That module
        // exports the token, but it is a sibling import here rather than an
        // ancestor, so its exports never reach this module's providers —
        // and the plan-change rule that reads bookings would resolve to
        // "none" and allow the move it exists to refuse.
        subscriptionBundleRepository: ctx.persistence?.entitlement?.subscriptionBundleRepository as
            ProviderSpec<SubscriptionBundleRepository> | undefined,
        // The versions those bookings name, for the same rule: whether an
        // add-on can run on the plan a change moves to is a question about the
        // version booked, not only its rhythm.
        bundleRepository: (ctx.persistence?.entitlement?.subscriptionBundleRepository
            ? resolveBundleRepository(ctx.persistence)
            : undefined) as ProviderSpec<BundleRepository> | undefined,
        subscriptionUsagePort: ctx.shared
            .subscriptionUsagePort as ProviderSpec<SubscriptionUsagePort>,
        usageSnapshotPort:
            usageSnapshotPort ??
            tenantSlice?.usageSnapshotPort ??
            quotaUsageSnapshotProvider(quotaProviders),
        subscriptionWritePort:
            subscriptionWritePort ??
            (tenantSlice?.subscriptionWritePort as ProviderSpec<TenantSubscriptionWritePort>),
        // The platform's runner, unless the application names its own: a
        // successor contract and the end of the one it replaces are written
        // on one transaction.
        contractFreeze: tenantOptions.contractFreeze && {
            transactionRunner: ctx.adapters.transactionRunner as
                ProviderSpec<TransactionRunner> | undefined,
            ...tenantOptions.contractFreeze,
        },
        // `version-notices.requires-notice-record` has refused a configuration
        // that reaches here with notices and nowhere to keep them.
        versionNotices: versionNotices && {
            ...versionNotices,
            notices: (versionNotices.notices ??
                tenantSlice?.subscriptionNotices) as ProviderSpec<SubscriptionNoticeRepository>,
            retirements: versionRetirementsOf(ctx),
        },
        imports: tenantImports ?? ctx.options.imports,
        extraProviders: [...quotaProviders, ...(extraProviders ?? [])],
        extraExports: [...quotaProviders, ...(extraExports ?? [])],
    });
    return [ctx.shared.tenantBillingModule];
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
            bundleRepository: resolveBundleRepository(ctx.persistence),
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

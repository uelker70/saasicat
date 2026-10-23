import type { DynamicModule } from '@nestjs/common';
import type {
    BundleRepository,
    ContractConfirmationArchivePort,
    ContractConfirmationRepository,
    SubscriptionBundleRepository,
    SubscriptionContractRepository,
    SubscriberPaymentRepository,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    TenantSubscriptionWritePort,
    TransactionRunner,
} from '@saasicat/core';

import { SubscriptionBundleModule } from '../../billing/subscription-bundles.module.js';
import {
    TenantBillingModule,
    type TenantBillingModuleOptions,
} from '../../billing/tenant-billing.module.js';
import type { ProviderSpec } from '../../core/di.js';
import { normalizeTenantAuthGuards, quotaUsageSnapshotProvider } from './tenant-bindings.js';

import { resolveBundleRepository } from './bundle-repository-source.js';
import { optionsOf, type CompositionContext } from './context.js';
import { featureWithdrawalsOf } from './feature-withdrawal.js';
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
        // The contracts, for the notice period a cancellation is judged by:
        // whichever module writes them is a sibling import here too, and
        // without them the cancellation would read the file over a contract
        // that recorded another.
        subscriptionContractRepository: contractRepositoryOf(ctx),
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
        // Collecting records what it tells a subscriber with the other
        // notices, in the bundle's record unless the application names one;
        // the confirmations are kept in the bundle's tables the same way.
        chargeJournal: withInvoiceDefaults(tenantOptions.chargeJournal, {
            // SAFETY: the bundle's member is the provider of the record of
            // notices, as `versionNotices.notices` reads it below.
            notices: tenantSlice?.subscriptionNotices as
                ProviderSpec<SubscriptionNoticeRepository> | undefined,
            // SAFETY: the bundle's member is the provider of the payments
            // repository, which `PersistenceProvider` types as the provider
            // spec it is.
            payments: ctx.persistence?.entitlement?.subscriberPaymentRepository as
                ProviderSpec<SubscriberPaymentRepository> | undefined,
            // SAFETY: the bundle's members are the providers of the record and
            // the archive of the confirmations, which `PersistenceProvider`
            // types as the provider specs they are.
            confirmationRepository: ctx.persistence?.entitlement?.contractConfirmationRepository as
                ProviderSpec<ContractConfirmationRepository> | undefined,
            // SAFETY: as above.
            confirmationArchive: ctx.persistence?.entitlement?.contractConfirmationArchive as
                ProviderSpec<ContractConfirmationArchivePort> | undefined,
        }),
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
            featureWithdrawals: featureWithdrawalsOf(ctx),
        },
        imports: tenantImports ?? ctx.options.imports,
        extraProviders: [...quotaProviders, ...(extraProviders ?? [])],
        extraExports: [...quotaProviders, ...(extraExports ?? [])],
    });
    return [ctx.shared.tenantBillingModule];
}

/**
 * The store of the contracts the installation keeps, as the module that
 * writes them is given it: the one named for `subscriptionContract` or for a
 * checkout offer's conclusion, or else the bundle's. Tenant billing's own
 * `contractFreeze` brings the one it freezes with.
 */
function contractRepositoryOf(
    ctx: CompositionContext,
): ProviderSpec<SubscriptionContractRepository> | undefined {
    // SAFETY: the bundle's member is the provider of the contract repository,
    // which `PersistenceProvider` types as the provider spec it is.
    const bundled = ctx.persistence?.entitlement?.subscriptionContractRepository as
        ProviderSpec<SubscriptionContractRepository> | undefined;
    return (
        optionsOf(ctx.options.subscriptionContract).subscriptionContractRepository ??
        optionsOf(ctx.options.checkoutOffer).conclusion?.subscriptionContractRepository ??
        bundled
    );
}

/**
 * The charge journal as the application configured it, with `notices` and
 * `payments` taken from the bundle where invoices are collected, and the
 * confirmations' record and archive where invoices confirm their contracts,
 * wherever the application names none.
 */
function withInvoiceDefaults(
    chargeJournal: TenantBillingModuleOptions['chargeJournal'],
    bundled: {
        notices: ProviderSpec<SubscriptionNoticeRepository> | undefined;
        payments: ProviderSpec<SubscriberPaymentRepository> | undefined;
        confirmationRepository: ProviderSpec<ContractConfirmationRepository> | undefined;
        confirmationArchive: ProviderSpec<ContractConfirmationArchivePort> | undefined;
    },
): TenantBillingModuleOptions['chargeJournal'] {
    const invoices = chargeJournal?.invoices;
    if (!chargeJournal || !invoices) return chargeJournal;
    const defaulted = { ...invoices };
    if (invoices.collections) {
        if (!defaulted.notices && bundled.notices) defaulted.notices = bundled.notices;
        if (!defaulted.payments && bundled.payments) defaulted.payments = bundled.payments;
    }
    if (invoices.confirmations) {
        defaulted.confirmations = {
            ...invoices.confirmations,
            repository: invoices.confirmations.repository ?? bundled.confirmationRepository,
            archive: invoices.confirmations.archive ?? bundled.confirmationArchive,
        };
    }
    return { ...chargeJournal, invoices: defaulted };
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
                          ...controller,
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

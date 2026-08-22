// The two shapes tenant billing needs its options in.
//
// Both are adapters between what the option lets an app write and what the
// low-level module takes — the kind of translation that has no home in either
// and ends up in the composition root by default.

import type { CanActivate, Type } from '@nestjs/common';
import type { QuotaProvider, UsageSnapshotPort } from '@saasicat/types';

import type { ProviderSpec } from '../../core/di.js';
import { QuotaProvidersUsageSnapshot } from '../quota-providers-usage-snapshot.js';
import type { SaaSiCatTenantAuthGuards } from '../module-options.js';

/**
 * Guard classes as a provider that resolves them.
 *
 * The option accepts either an array of classes — the readable form, and what
 * every consumer writes — or a `ProviderSpec` for the app that builds its chain
 * dynamically. The module wants the second, so the first is wrapped rather than
 * being a second code path inside it.
 */
export function normalizeTenantAuthGuards(
    guards: SaaSiCatTenantAuthGuards,
): ProviderSpec<ReadonlyArray<CanActivate>> {
    if (!Array.isArray(guards)) return guards;
    return {
        useFactory: (...instances: CanActivate[]) => instances,
        inject: guards,
    };
}

/**
 * A usage snapshot assembled from the app's own quota providers.
 *
 * The fallback when nothing supplies a `usageSnapshotPort`: the providers
 * already know how to count, so a tenant sees its usage without the app
 * implementing a second way to read the same numbers.
 */
export function quotaUsageSnapshotProvider(
    quotaProviders: ReadonlyArray<Type<QuotaProvider>>,
): ProviderSpec<UsageSnapshotPort> {
    return {
        useFactory: (...providers: QuotaProvider[]) => new QuotaProvidersUsageSnapshot(providers),
        inject: [...quotaProviders],
    };
}

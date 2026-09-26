// What a composer may look at.
//
// `forRoot` used to be one ~600-line procedure: normalise eight adapter slots,
// throw fifteen times, then twelve `if (config) imports.push(XModule.forRoot(…))`
// blocks, a hand-assembled provider list and a twelve-armed `exports` array.
// Nothing in it was wrong; it just meant every new feature touched four places
// in one file, and the file imported from eleven of the fourteen domains.
//
// The composers are that middle section, one per feature. Each takes this and
// returns the modules it contributes — so what a feature reads is its
// signature, and adding one is a file rather than four edits.
//
// One thing is deliberately NOT hidden: the composers are ordered, because two
// of them share state. `tenantBilling` resolves the auth guards and the usage
// port, and `subscriptionBundles` and the entitlement runtime read what it
// resolved. That used to be three `let`s in the middle of the procedure, where
// it was invisible; here it is a named field with a comment on it, and the
// order it implies is stated in `compose/index.ts`.

import type { CanActivate, DynamicModule, Type } from '@nestjs/common';
import type { SaaSiCatPersistenceAdapter, SubscriptionUsagePort } from '@saasicat/core';

import { SuperAdminGuard } from '../../admin/super-admin.guard.js';
import type { ProviderSpec } from '../../core/di.js';
import type { DiscoveryAppInfo } from '../../discovery/discovery.scanner.js';
import type { SaaSiCatAdapters, SaaSiCatModuleOptions } from '../module-options.js';

/**
 * What `tenantBilling` resolved and its dependants need.
 *
 * Mutable, and the only mutable thing here: `composeTenantBilling` and
 * `composeAdminResources` write it; `composeSubscriptionBundles`,
 * `composeSubscriberAccount` and the entitlement runtime read it. A composer
 * that runs before them sees the initial values, which is correct — there was
 * nothing resolved yet.
 */
export interface SharedTenantBinding {
    /** Normalised `authGuards`, shared with the bundle controller. */
    authGuards?: ProviderSpec<ReadonlyArray<CanActivate>>;
    /** The usage port both controllers report against. */
    subscriptionUsagePort?: ProviderSpec<SubscriptionUsagePort>;
    /**
     * Whether the tenant-billing module already registered the app's quota
     * providers.
     *
     * It registers them as its own providers and exports, so the entitlement
     * runtime must not register them a second time — two instances of a
     * `QuotaProvider` are two counters over the same rows.
     */
    quotaProvidersHostedByTenantBilling: boolean;
    /**
     * The modules that hold the administration's tenants and the tenant's
     * billing, as the very objects the platform imports. A module that needs
     * what they provide imports these objects: Nest builds a module once per
     * object, so the adapters inside are not instantiated a second time.
     */
    adminResourcesModule?: DynamicModule;
    tenantBillingModule?: DynamicModule;
}

/**
 * The guard chain for a route only the platform's administrator may reach.
 *
 * `controller.guards` establishes who is calling; whether that caller is the
 * platform administrator is decided here, once, for every operator route a
 * composer mounts. Authentication alone admits every signed-in tenant user,
 * and the tenant manifest falls back to `controller.guards` for exactly that
 * reason — so the role check cannot live in that list, and has to live here.
 */
export function operatorGuards(options: SaaSiCatModuleOptions): Array<Type<CanActivate>> {
    return [...options.controller.guards, SuperAdminGuard];
}

export interface CompositionContext {
    readonly options: SaaSiCatModuleOptions;
    /** After the bundle slices and the explicit entries have been merged. */
    readonly adapters: SaaSiCatAdapters;
    readonly persistence: SaaSiCatPersistenceAdapter | undefined;
    /** App key and version, for discovery and the public catalogue. */
    readonly appInfo: DiscoveryAppInfo;
    /** Entitlement is needed directly, or by tenant billing / bundles. */
    readonly requiresFullEntitlement: boolean;
    readonly shared: SharedTenantBinding;
}

/**
 * The option object of a `false | true | Options` slot.
 *
 * Every feature slot spells "on" three ways — absent, a boolean, or an object.
 * Only the object carries settings, and each composer had to unpack that.
 */
export function optionsOf<T extends object>(slot: false | true | T | undefined): T {
    return typeof slot === 'object' ? slot : ({} as T);
}

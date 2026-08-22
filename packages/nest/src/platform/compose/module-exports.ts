// What the platform module re-exports, so an app can inject the services it
// composed without importing each low-level module.
//
// Derived from which features are on, and that mirroring is why it is here:
// the list used to be a twelve-armed array at the bottom of `forRoot`, two
// hundred lines away from the `if` that decides each arm. A feature that
// gained a module and not an export line was a `UnknownDependenciesException`
// in a consumer, and nothing in the file put the two halves next to each other.

import type { DynamicModule } from '@nestjs/common';

import { AdminManifestModule } from '../../admin/admin-manifest.module.js';
import { AdminResourcesModule } from '../../admin/admin-resources.module.js';
import { AdminStatsModule } from '../../admin/admin-stats.module.js';
import { AdminModule } from '../../admin/module.js';
import { PlanCatalogModule } from '../../billing/plan-catalog.module.js';
import { SubscriptionBundleModule } from '../../billing/subscription-bundles.module.js';
import { TenantBillingModule } from '../../billing/tenant-billing.module.js';
import { CatalogModule } from '../../catalog/catalog.module.js';
import { CheckoutOfferModule } from '../../checkout-offer/checkout-offer.module.js';
import { DiscoveryModule } from '../../discovery/discovery.module.js';
import { EntitlementModule } from '../../entitlement/module.js';
import { PromoCodesModule } from '../../promo/module.js';
import { SetupModule } from '../../setup/setup.module.js';
import { SubscriptionContractModule } from '../../subscription-contract/subscription-contract.module.js';

import type { CompositionContext } from './context.js';

/** Always exported — every configuration has them. */
const ALWAYS = [
    PlanCatalogModule,
    DiscoveryModule,
    AdminModule,
    // ADMIN_MANIFEST_CONFIG travels transitively: re-exporting an imported
    // module's token directly is an UnknownExportException at boot — the module
    // export here already carries it.
    AdminManifestModule,
];

/** Each optional module, paired with the option that mounts it. */
function optionalExports({ options, requiresFullEntitlement }: CompositionContext) {
    return [
        [requiresFullEntitlement, EntitlementModule],
        [options.catalog, CatalogModule],
        [options.tenantBilling, TenantBillingModule],
        [options.subscriptionBundles, SubscriptionBundleModule],
        [options.adminResources, AdminResourcesModule],
        [options.promoCodes, PromoCodesModule],
        [options.setup, SetupModule],
        [options.adminStats, AdminStatsModule],
        [options.checkoutOffer, CheckoutOfferModule],
        [options.subscriptionContract, SubscriptionContractModule],
    ] as const;
}

/**
 * Mounted on purpose and deliberately not re-exported.
 *
 * Declared here rather than left as an absence, because the guard in
 * `tests/platform-composition.test.js` otherwise reports it every time and the
 * next person has to re-derive whether it is a bug.
 *
 * `PublicCatalogModule` is a controller and one token, `FEATURE_UI_REGISTRY` —
 * which the APP supplies through `catalog: { featureUiRegistry }` rather than
 * injects. Re-exporting it would also collide with the identically named token
 * from `billing`, which means something else (see CONTRIBUTING, "One bundle,
 * many entries").
 */
export const MOUNTED_BUT_NOT_EXPORTED: readonly string[] = ['PublicCatalogModule'];

/** The `exports` of the assembled module, plus whatever it provides itself. */
export function composeModuleExports(
    ctx: CompositionContext,
    ownExports: NonNullable<DynamicModule['exports']>,
): NonNullable<DynamicModule['exports']> {
    return [
        ...ALWAYS,
        ...optionalExports(ctx)
            .filter(([enabled]) => Boolean(enabled))
            .map(([, module]) => module),
        ...ownExports,
    ];
}

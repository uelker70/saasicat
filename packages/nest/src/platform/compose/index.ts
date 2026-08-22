// The feature composers, in the order they run.
//
// Ordered, not sorted: `composeTenantBilling` resolves the auth guards and the
// usage port that `composeSubscriptionBundles` reads, so it has to run first.
// That dependency used to be three `let`s in the middle of a 600-line
// procedure; here it is a list with a comment, and `SharedTenantBinding` is
// where the values live.
//
// Everything else is independent. A new feature is a file plus a line here.

import type { DynamicModule } from '@nestjs/common';

import { composeAdminResources } from './admin-resources.js';
import { composeCatalog } from './catalog.js';
import type { CompositionContext } from './context.js';
import { composeEntitlement } from './entitlement.js';
import {
    composeAdminStats,
    composeCheckoutOffer,
    composeSetup,
    composeSubscriptionContract,
} from './optional-modules.js';
import { composePromoCodes } from './promo-codes.js';
import { composeSubscriptionBundles, composeTenantBilling } from './tenant-billing.js';

/** One feature's contribution: the modules it adds, or none. */
export type Composer = (ctx: CompositionContext) => DynamicModule[];

export const FEATURE_COMPOSERS: readonly Composer[] = [
    composeEntitlement,
    composeCatalog,
    composeAdminResources,
    composePromoCodes,
    // Before the bundles — see the note above.
    composeTenantBilling,
    composeSubscriptionBundles,
    composeSetup,
    composeAdminStats,
    composeCheckoutOffer,
    composeSubscriptionContract,
];

/** Every module the enabled features contribute, in composer order. */
export function composeFeatures(ctx: CompositionContext): DynamicModule[] {
    return FEATURE_COMPOSERS.flatMap((compose) => compose(ctx));
}

export * from './context.js';
export * from './tenant-bindings.js';

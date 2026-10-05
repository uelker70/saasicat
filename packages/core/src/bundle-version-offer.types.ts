// A newer version of an add-on a subscription has booked, read as an offer to
// that booking. It follows a plan's offer (`version-offer.ts`) and differs
// where a booking differs from a subscription: both versions are priced beside
// the subscription's plan, the kind of offer is judged in the rhythm the
// booking is billed in, and a switch that takes something away waits for the
// end of the booking's own running term.

import type { BillingCycle } from './promo-code.types.js';
import type { BundleVersionSide } from './bundle-version-retirement.types.js';
import type { VersionChange } from './subscription.types.js';
import type { VersionOfferClass } from './version-offer.js';

/**
 * A newer version of a booked add-on, offered beside the booking: the version
 * booked and the one on sale side by side, what kind of offer it is, and when
 * a switch taken now would take effect — at once, or, for one that takes
 * something away, at the end of the booking's running term. The list of the
 * tenant's bookings carries it on each booking, as `offer`.
 */
export interface BundleVersionOfferView {
    readonly subscriptionBundleId: string;
    /** The plan both versions are priced beside: the one the subscription is on. */
    readonly planKey: string;
    /** The rhythm the booking is billed in, which the kind of offer is judged in. */
    readonly billingCycle: BillingCycle;
    readonly bound: BundleVersionSide;
    readonly offered: BundleVersionSide;
    readonly class: Exclude<VersionOfferClass, 'same'>;
    /** Every difference, bound to offered, with the price in the booking's rhythm alone. */
    readonly changes: readonly VersionChange[];
    /** ISO instant. */
    readonly takesEffectAt: string;
}

/**
 * What taking an add-on offer did: the booking, the version left and the one
 * taken, and whether it applied at once or waits for `takesEffectAt`.
 */
export interface BundleVersionSwitchResult {
    readonly class: Exclude<VersionOfferClass, 'same'>;
    readonly subscriptionBundleId: string;
    readonly fromBundleVersionId: string;
    readonly bundleVersionId: string;
    readonly immediate: boolean;
    /** ISO instant. */
    readonly takesEffectAt: string;
}

// An add-on as the plan pages offer it beside the plans: which features it
// adds and which plans it can be booked on.

import { versionOnSaleOrNext, type VersionSaleDates } from './version-sale.js';

/** An add-on offered beside the plans. */
export interface AvailableBundle {
    bundleKey: string;
    label?: string | null;
    features: string[];
    /** Plan keys it can be booked on; empty means every plan. */
    compatiblePlanKeys: string[];
}

/** The parts of a bundle version this reads. */
export interface AvailableBundleVersion extends VersionSaleDates {
    readonly version?: number;
    readonly features?: string[];
    readonly compatibility?: { readonly planIds?: string[] | null } | null;
}

/**
 * The add-on as the plan pages offer it: its version on sale, otherwise the
 * next one scheduled — as the matrix shows a plan. An add-on with neither is
 * not offered at all: its list of plans would be empty, and an empty list
 * reads as "every plan", so it would show as bookable everywhere though
 * nothing of it can be booked.
 */
export function availableBundle(
    bundle: { bundleKey: string; label?: string | null },
    versions: readonly AvailableBundleVersion[],
    now: Date,
): AvailableBundle | null {
    const shown = versionOnSaleOrNext(versions, now);
    if (!shown) return null;
    return {
        bundleKey: bundle.bundleKey,
        label: bundle.label,
        features: shown.features ?? [],
        // `compatibility.planIds` holds plan KEYS (see the public marketing catalogue).
        compatiblePlanKeys: shown.compatibility?.planIds ?? [],
    };
}

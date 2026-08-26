import type { BillingCycle, BundleVersionRow } from '@saasicat/core';

// What a bundle costs a given plan in a given rhythm.
//
// Its own module rather than a corner of the preview service, because both the
// preview and the booking have to answer the same question and get the same
// answer. A preview that blocks a priceless combination while the booking
// accepts it is enforcement in the client: a caller posting straight to the
// route never sees the blocker.

/**
 * List price (net) for the billing cycle, including a plan-specific pricing
 * override (`BundlePricingOverride` with `planId`).
 *
 * `null` means no price is maintained for that combination — not that the
 * bundle is free. A published bundle always resolves *some* price, which the
 * publish gate checks; what it cannot check is the combination, since that
 * depends on the plan the tenant is on and the rhythm they are billed in.
 */
export function resolveBundlePriceNet(
    bundleVersion: BundleVersionRow,
    planKey: string,
    billingCycle: string,
): number | null {
    const override = (bundleVersion.pricingOverrides ?? []).find((o) => o.planId === planKey);
    const yearly = billingCycle === 'YEARLY';
    const raw = yearly
        ? override?.yearlyNet !== undefined
            ? override.yearlyNet
            : bundleVersion.yearlyNet
        : override?.monthlyNet !== undefined
          ? override.monthlyNet
          : bundleVersion.monthlyNet;
    if (raw === null || raw === undefined) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The cycles a plan version is actually sold in.
 *
 * Derived from the prices it carries rather than from a list of cycles, so a
 * plan priced monthly only is a monthly plan and nothing has to say so
 * separately. A version with neither price is sold in no cycle at all — the
 * plan's own publish gate refuses that, and here it simply asks nothing.
 */
export function cyclesSoldFor(planVersion: {
    monthlyNet?: string | null;
    yearlyNet?: string | null;
}): BillingCycle[] {
    const cycles: BillingCycle[] = [];
    if (planVersion.monthlyNet != null) cycles.push('MONTHLY');
    if (planVersion.yearlyNet != null) cycles.push('YEARLY');
    return cycles;
}

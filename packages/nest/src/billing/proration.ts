// Shared proration calculation for self-service previews (#37).
//
// Plan change (PlanChangePreviewService) and bundle add
// (SubscriptionBundlePreviewService) use the same formula:
// prorated surcharge/credit = (target price − current price) ×
// remaining days / period days. Day granularity, commercially rounded
// to 2 decimal places.

const DAY_MS = 86_400_000;

export interface ProrationDto {
    daysRemainingInPeriod: number;
    daysInPeriod: number;
    periodStart: Date;
    periodEnd: Date;
    currentPriceNet: number;
    targetPriceNet: number;
    /** Prorated surcharge/credit until end of period. Negative = credit. */
    prorataDeltaNet: number;
}

export interface ProrationInput {
    periodStart: Date;
    periodEnd: Date;
    now: Date;
    /** Previous period price (bundle add: 0 — something is only added). */
    currentPriceNet: number;
    targetPriceNet: number;
}

export function computeProration(input: ProrationInput): ProrationDto {
    const { periodStart, periodEnd, now, currentPriceNet, targetPriceNet } = input;

    const daysInPeriod = Math.max(
        1,
        Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY_MS),
    );
    const daysRemaining = Math.max(
        0,
        Math.min(daysInPeriod, Math.round((periodEnd.getTime() - now.getTime()) / DAY_MS)),
    );
    const prorataDeltaNet = round2(
        ((targetPriceNet - currentPriceNet) * daysRemaining) / daysInPeriod,
    );

    return {
        daysRemainingInPeriod: daysRemaining,
        daysInPeriod,
        periodStart,
        periodEnd,
        currentPriceNet,
        targetPriceNet,
        prorataDeltaNet,
    };
}

// Local instead of imported from ../promo: the sub-entries (billing/promo)
// bundle separately — a cross-entry import would duplicate the promo module
// into the billing chunk.
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

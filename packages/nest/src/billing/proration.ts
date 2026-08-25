// Shared proration calculation for self-service previews (#37).
//
// Plan change (PlanChangePreviewService) and bundle add
// (SubscriptionBundlePreviewService) use the same formula:
// prorated surcharge = (target price − current price) ×
// remaining days / period days. Day granularity, commercially rounded
// to 2 decimal places, and never negative — see `prorataDeltaNet`.

const DAY_MS = 86_400_000;

export interface ProrationDto {
    daysRemainingInPeriod: number;
    daysInPeriod: number;
    periodStart: Date;
    periodEnd: Date;
    currentPriceNet: number;
    targetPriceNet: number;
    /**
     * What the change costs for the rest of the period, never below zero.
     *
     * The raw arithmetic goes negative when the target is cheaper than what is
     * running — after a price reduction, an upgrade can arrive at a negative
     * number. That is not a credit: this platform does not pay money back, and
     * a negative charge carried into an invoice is a refund nobody agreed to.
     * It is a free upgrade, and `isFree` is how a page says so.
     */
    prorataDeltaNet: number;
    /**
     * The unclamped result, kept because the page has something to say about it.
     *
     * Dropping it would make "free" indistinguishable from "costs exactly
     * nothing", and those read differently to someone deciding.
     */
    rawDeltaNet: number;
    /** True when the arithmetic asked for less than nothing. */
    isFree: boolean;
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
    const rawDeltaNet = round2(((targetPriceNet - currentPriceNet) * daysRemaining) / daysInPeriod);
    const prorataDeltaNet = Math.max(0, rawDeltaNet);

    return {
        daysRemainingInPeriod: daysRemaining,
        daysInPeriod,
        periodStart,
        periodEnd,
        currentPriceNet,
        targetPriceNet,
        prorataDeltaNet,
        rawDeltaNet,
        isFree: rawDeltaNet <= 0,
    };
}

// Local instead of imported from ../promo: the sub-entries (billing/promo)
// bundle separately — a cross-entry import would duplicate the promo module
// into the billing chunk.
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

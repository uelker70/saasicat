// Shared proration calculation for self-service previews (#37).
//
// Plan change (PlanChangePreviewService) and bundle add
// (SubscriptionBundlePreviewService) use the same formula:
// prorated surcharge = (target price − current price) ×
// remaining days / period days. Day granularity, commercially rounded
// to 2 decimal places, and never negative — see `prorataDeltaNet`.
//
// An upgrade into a longer rhythm is the one case that does not run inside the
// period already paid: its period starts on the day of the change, so it is
// charged in full, less what is left of the period it replaces
// (`computeNewPeriodCharge`).

const DAY_MS = 86_400_000;

/**
 * How a charge relates to the period already paid.
 *
 * `difference` — the target runs inside it, and the price difference is
 * charged for what is left. `newPeriod` — the target starts a period of its own
 * today, charged in full less the unused remainder of the one it replaces.
 */
export type ProrationBasis = 'difference' | 'newPeriod';

export interface ProrationDto {
    basis: ProrationBasis;
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
    /**
     * True when the arithmetic asked for less than nothing.
     *
     * Strictly less: a change that costs exactly zero — equal prices, or a
     * remaining fraction that rounds the difference away — is not a free
     * upgrade, it is a change with no price difference. `rawDeltaNet` exists
     * above precisely so a page can tell those apart, and a flag that merges
     * them takes that back.
     */
    isFree: boolean;
    /**
     * What is left of the replaced period at its own price, net — the amount a
     * `newPeriod` charge is reduced by. Zero on a `difference`, where the
     * remainder is what the difference is taken over.
     */
    remainderNet: number;
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
    const { daysInPeriod, daysRemaining } = daysOf(periodStart, periodEnd, now);
    const rawDeltaNet = round2(((targetPriceNet - currentPriceNet) * daysRemaining) / daysInPeriod);

    return {
        basis: 'difference',
        daysRemainingInPeriod: daysRemaining,
        daysInPeriod,
        periodStart,
        periodEnd,
        currentPriceNet,
        targetPriceNet,
        prorataDeltaNet: Math.max(0, rawDeltaNet),
        rawDeltaNet,
        isFree: rawDeltaNet < 0,
        remainderNet: 0,
    };
}

/**
 * The charge for a target that starts a period of its own today: its full
 * price, less the unused remainder of the period it replaces.
 *
 * `periodStart`/`periodEnd` are the replaced period's, and `currentPriceNet`
 * its price — the remainder is taken at the price that was paid for it. The
 * remainder only reduces this charge: floored at zero like every other
 * proration, it is never paid out.
 */
export function computeNewPeriodCharge(input: ProrationInput): ProrationDto {
    const { periodStart, periodEnd, now, currentPriceNet, targetPriceNet } = input;
    const { daysInPeriod, daysRemaining } = daysOf(periodStart, periodEnd, now);
    const remainderNet = round2((currentPriceNet * daysRemaining) / daysInPeriod);
    const rawDeltaNet = round2(targetPriceNet - remainderNet);

    return {
        basis: 'newPeriod',
        daysRemainingInPeriod: daysRemaining,
        daysInPeriod,
        periodStart,
        periodEnd,
        currentPriceNet,
        targetPriceNet,
        prorataDeltaNet: Math.max(0, rawDeltaNet),
        rawDeltaNet,
        isFree: rawDeltaNet < 0,
        remainderNet,
    };
}

function daysOf(
    periodStart: Date,
    periodEnd: Date,
    now: Date,
): { daysInPeriod: number; daysRemaining: number } {
    const daysInPeriod = Math.max(
        1,
        Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY_MS),
    );
    const daysRemaining = Math.max(
        0,
        Math.min(daysInPeriod, Math.round((periodEnd.getTime() - now.getTime()) / DAY_MS)),
    );
    return { daysInPeriod, daysRemaining };
}

// Local instead of imported from ../promo: the sub-entries (billing/promo)
// bundle separately — a cross-entry import would duplicate the promo module
// into the billing chunk.
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

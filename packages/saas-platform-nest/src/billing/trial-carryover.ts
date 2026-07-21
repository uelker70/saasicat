// Trial carry-over formula (#17) — generic in the platform.
//
// When a Tenant switches Plan DURING the trial, the remaining trial time is
// carried over:
//   newTrialTime = trialDays(target) − consumed trial days, min. 0
//   consumed     = trialDays(current) − remaining days; remaining days from `currentTrialEndsAt`.
//
// Since `currentTrialEndsAt − trialDays(current)` invariantly reconstructs the
// trial start, the calculation is drift-free across multiple switches. The
// trial config (trial days per Plan) stays consumer-side (e.g.
// `MarketingProjection.trialDays`) and is passed in via the `TrialProjectionPort`
// — only the formula is generic.

const MS_PER_DAY = 86_400_000;

export function computeCarriedTrialEndsAt(
    currentTrialDays: number,
    newTrialDays: number,
    currentTrialEndsAt: Date,
    now: Date,
): Date {
    const daysRemaining = Math.max(
        0,
        Math.ceil((currentTrialEndsAt.getTime() - now.getTime()) / MS_PER_DAY),
    );
    const usedDays = Math.max(0, currentTrialDays - daysRemaining);
    const newDays = Math.max(0, newTrialDays - usedDays);
    return new Date(now.getTime() + newDays * MS_PER_DAY);
}

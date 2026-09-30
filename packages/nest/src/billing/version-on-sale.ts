import type { PlanRepository, PlanVersionRow } from '@saasicat/core';

/**
 * The version a booking made now would bind: the one active by its validity
 * window, and the newest live one only where the repository reads no windows.
 * An active lookup that finds nothing means nothing is on sale — falling back
 * past it would offer a version whose window has not opened.
 */
export async function versionOnSale(
    plans: PlanRepository,
    planKey: string,
    now: Date,
): Promise<PlanVersionRow | null> {
    if (plans.findActivePlanVersion) return plans.findActivePlanVersion(planKey, now);
    return (await plans.findLatestLivePlanVersion?.(planKey)) ?? null;
}

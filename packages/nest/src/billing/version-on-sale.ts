import type { PlanRepository, PlanVersionRow } from '@saasicat/core';

/**
 * The version of a plan on sale at `asOf`: the one a booking made then binds,
 * by its validity window. Every read that names what is on sale — the
 * plan-change preview, checkout, the public marketing catalogue, the add-on
 * preview, the offer to existing subscribers and its notice — asks here, so
 * they cannot name different versions at the same moment.
 *
 * `null` where nothing is on sale, and where the repository reads no versions
 * at all (a catalogue given as a file). A repository that reads versions but
 * not by window is refused at start-up rather than answered with its newest
 * one, which would sell a version before the day it applies from.
 */
export async function versionOnSale(
    plans: PlanRepository,
    planKey: string,
    asOf: Date,
): Promise<PlanVersionRow | null> {
    return (await plans.findActivePlanVersion?.(planKey, asOf)) ?? null;
}

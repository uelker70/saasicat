// What an add-on of the public catalogue costs beside the plan a prospect has
// chosen, read from the catalogue's price per plan — the price its contract
// takes. The add-on's own price is only what it costs before a plan's override,
// so it is shown, marked, while no plan is chosen and never charged.

import type { BillingCycle, PublicBundlePlanPrice, PublicMarketingBundle } from '@saasicat/core';

/** The parts of a catalogue add-on its price beside a plan is read from. */
export type AddOnPrices = Pick<PublicMarketingBundle, 'monthlyNet' | 'yearlyNet' | 'planPrices'>;

/**
 * The add-on's price beside a plan in a rhythm.
 *
 * - `priced`: what the contract for the chosen plan takes.
 * - `depends-on-plan`: no plan is chosen yet; `baseNet` is the add-on's own
 *   price in the rhythm, `null` where it has none and only a plan prices it.
 * - `not-in-cycle`: it can be had, but not in this rhythm.
 * - `not-with-plan`: it cannot be had with the chosen plan, or with any plan.
 */
export type AddOnPriceBeside =
    | { kind: 'priced'; net: number }
    | { kind: 'depends-on-plan'; baseNet: number | null }
    | { kind: 'not-in-cycle' }
    | { kind: 'not-with-plan' };

/** A price in the rhythm, never derived from the other one. */
function inCycle(
    prices: { monthlyNet: number | null; yearlyNet: number | null },
    cycle: BillingCycle,
): number | null {
    return cycle === 'YEARLY' ? prices.yearlyNet : prices.monthlyNet;
}

function entryFor(add: AddOnPrices, planKey: string): PublicBundlePlanPrice | undefined {
    return add.planPrices.find((entry) => entry.planKey === planKey);
}

/**
 * What the add-on costs beside `planKey` in `cycle`; `planKey` is `null` while
 * no plan is chosen. A price the catalogue does not name is never read as 0.
 */
export function addOnPriceBeside(
    add: AddOnPrices,
    planKey: string | null,
    cycle: BillingCycle,
): AddOnPriceBeside {
    if (planKey !== null) {
        const entry = entryFor(add, planKey);
        if (!entry) return { kind: 'not-with-plan' };
        const net = inCycle(entry, cycle);
        return net === null ? { kind: 'not-in-cycle' } : { kind: 'priced', net };
    }
    if (add.planPrices.length === 0) return { kind: 'not-with-plan' };
    // A base price no plan sells in the rhythm is no offer.
    if (!add.planPrices.some((entry) => inCycle(entry, cycle) !== null)) {
        return { kind: 'not-in-cycle' };
    }
    return { kind: 'depends-on-plan', baseNet: inCycle(add, cycle) };
}

/** Whether the add-on can be had with every one of `planKeys`. */
export function isOfferedWithEveryPlan(add: AddOnPrices, planKeys: readonly string[]): boolean {
    return planKeys.every((planKey) => entryFor(add, planKey) !== undefined);
}

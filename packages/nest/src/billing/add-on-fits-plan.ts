import {
    BILLING_ERROR_CODES,
    type BillingCycle,
    type BundleRepository,
    type BundleVersionRow,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
} from '@saasicat/core';

import { bundleCycleFitsPlan } from './bundle-period.js';
import { resolveBundlePriceNet } from './bundle-price.js';
import type { BundleBookingRefusal } from './bundle-version-not-on-sale.js';

/**
 * Why an add-on cannot run beside a plan:
 *
 * - `not-allowed` — it is restricted to other plans (`SC-BUN-025`).
 * - `not-priced` — it has no price for that plan in the rhythm it is billed in.
 *   Publishing checks that a version has some price, not every combination of
 *   plan and rhythm a tenant can be in, so this is asked where both are known.
 * - `longer-rhythm` — it is billed yearly beside a monthly plan, and would still
 *   be committed on every day the plan could end (`SC-BUN-004`).
 */
export type AddOnMisfit = 'not-allowed' | 'not-priced' | 'longer-rhythm';

/** A plan an add-on runs beside: its key, and the rhythm the plan is billed in. */
export interface PlanBeside {
    readonly planKey: string;
    readonly billingCycle: BillingCycle;
}

/** A plan a subscription is already set to move to, and when it moves there. */
export interface PlanAhead extends PlanBeside {
    readonly from: Date;
}

/**
 * Every reason `version`, billed in `addOnCycle`, cannot run beside `plan`, in
 * the order above; empty where it can.
 *
 * One rule wherever an add-on and a plan meet: a booking and its preview,
 * checkout, a plan change and a retirement. Asked in parts, the parts drift
 * apart: a check of the rhythm alone lets an add-on restricted to one plan run
 * on after a move to another.
 */
export function addOnMisfits(
    version: BundleVersionRow,
    plan: PlanBeside,
    addOnCycle: BillingCycle,
): AddOnMisfit[] {
    const misfits: AddOnMisfit[] = [];
    const allowed = version.compatibility?.planIds ?? [];
    if (allowed.length > 0 && !allowed.includes(plan.planKey)) misfits.push('not-allowed');
    if (resolveBundlePriceNet(version, plan.planKey, addOnCycle) === null) {
        misfits.push('not-priced');
    }
    if (!bundleCycleFitsPlan(addOnCycle, plan.billingCycle)) misfits.push('longer-rhythm');
    return misfits;
}

/**
 * What a booking says, and its preview shows, for `misfit` beside the plan the
 * subscription is on.
 */
export function misfitRefusal(
    misfit: AddOnMisfit,
    version: BundleVersionRow,
    plan: PlanBeside,
    addOnCycle: BillingCycle,
): BundleBookingRefusal {
    switch (misfit) {
        case 'not-allowed': {
            const allowedPlanKeys = (version.compatibility?.planIds ?? []).join(', ');
            return {
                code: BILLING_ERROR_CODES.BUNDLE_INCOMPATIBLE_WITH_PLAN,
                message:
                    `BundleVersion '${version.id}' is not compatible with plan ` +
                    `'${plan.planKey}'. Allowed: [${allowedPlanKeys}].`,
                params: { bundleVersionId: version.id, planKey: plan.planKey, allowedPlanKeys },
            };
        }
        case 'not-priced':
            return {
                code: BILLING_ERROR_CODES.BUNDLE_NOT_PRICED_FOR_THIS_PLAN,
                message:
                    `This bundle has no ${addOnCycle.toLowerCase()} price for the ` +
                    `${plan.planKey} plan, so it cannot be booked from here.`,
                params: { billingCycle: addOnCycle, planKey: plan.planKey },
            };
        case 'longer-rhythm':
            return {
                code: BILLING_ERROR_CODES.BUNDLE_CYCLE_EXCEEDS_PLAN,
                message:
                    'A yearly bundle cannot run beside a monthly plan: it would still be ' +
                    'committed on every day the plan could end.',
                params: { billingCycle: addOnCycle, planCycle: plan.billingCycle },
            };
    }
}

/**
 * The refusals for booking `version`, billed in `addOnCycle`, on a subscription
 * already set to move to the plans `ahead`: one for each of them it cannot run
 * on.
 *
 * A booking runs until it is cancelled, so it meets every one of those moves,
 * except one that comes no earlier than the end of the subscription itself
 * (`parentEndsAt`), which nothing then moves. Asking only about the plan of
 * today would let a booking made after a change was scheduled land on a plan
 * it was never sold for, since the change itself lands without looking at
 * add-ons.
 */
export function plansAheadRefusals(
    version: BundleVersionRow,
    ahead: readonly PlanAhead[],
    addOnCycle: BillingCycle,
    parentEndsAt: Date | null,
): BundleBookingRefusal[] {
    const refusals: BundleBookingRefusal[] = [];
    for (const plan of ahead) {
        if (parentEndsAt !== null && plan.from >= parentEndsAt) continue;
        const [misfit] = addOnMisfits(version, plan, addOnCycle);
        if (misfit) refusals.push(upcomingRefusal(misfit, plan));
    }
    return refusals;
}

/**
 * What a booking is told about a plan ahead it cannot run on. Where that plan
 * books and prices the add-on and only the rhythm is in the way — always the
 * case for a switch of rhythm on the plan the subscription keeps — the
 * sentence names the rhythm: naming the plan would point at the one the
 * subscription is already on. Its cycle words are part of each locale's
 * sentence rather than values filled into it, because only a yearly bundle
 * beside a monthly plan fails the rhythm.
 */
function upcomingRefusal(misfit: AddOnMisfit, plan: PlanAhead): BundleBookingRefusal {
    const from = plan.from.toISOString().slice(0, 10);
    if (misfit === 'longer-rhythm') {
        return {
            code: BILLING_ERROR_CODES.BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE,
            message:
                'A yearly bundle cannot run beside the monthly billing the subscription moves ' +
                `to with effect from ${from}.`,
            params: { planKey: plan.planKey, billingCycle: plan.billingCycle, from },
        };
    }
    return {
        code: BILLING_ERROR_CODES.BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN,
        message:
            `This bundle cannot run on the ${plan.planKey} plan, which the subscription moves ` +
            `to with effect from ${from}.`,
        params: { planKey: plan.planKey, billingCycle: plan.billingCycle, from },
    };
}

/** A booking still running, with the version it names and the first reason it cannot run beside a plan. */
export interface HeldAddOnMisfit {
    readonly booking: SubscriptionBundleRecord;
    readonly version: BundleVersionRow | null;
    readonly misfit: AddOnMisfit;
}

/**
 * The bookings of a subscription still running at `at` whose add-on cannot run
 * beside `plan` — what stands in the way of moving it there.
 *
 * A booking without a rhythm of its own follows the plan's, so it is priced in
 * that plan's and fits its rhythm by construction. Where the version booked
 * cannot be read — a booked version cannot be deleted, so the row is broken —
 * only its rhythm is asked, which needs nothing else.
 */
export async function heldAddOnMisfits(
    bookings: Pick<SubscriptionBundleRepository, 'listActiveBySubscription'>,
    bundles: Pick<BundleRepository, 'findVersionById'> | null,
    subscriptionId: string,
    plan: PlanBeside,
    at: Date,
): Promise<HeldAddOnMisfit[]> {
    const held: HeldAddOnMisfit[] = [];
    for (const booking of await bookings.listActiveBySubscription(subscriptionId, at)) {
        const addOnCycle = booking.billingCycle ?? plan.billingCycle;
        const version = bundles ? await bundles.findVersionById(booking.bundleVersionId) : null;
        const [misfit] = version
            ? addOnMisfits(version, plan, addOnCycle)
            : bundleCycleFitsPlan(addOnCycle, plan.billingCycle)
              ? []
              : (['longer-rhythm'] as const);
        if (misfit) held.push({ booking, version, misfit });
    }
    return held;
}

/**
 * What a plan change says about an add-on still booked that cannot run on
 * the plan it moves to: its name, the earliest day it can end
 * (`addOnInTheWay`), and how to get past it.
 *
 * Two things have to hold, and either may be missing: the add-on has to be
 * cancelled, and the change has to take effect once it has ended. So the
 * sentence names both rather than only the cancellation, which the cancel
 * route refuses for a booking already cancelled and which does not by itself
 * clear a change taking effect before that day.
 *
 * The rhythm keeps its own code rather than `BUNDLE_CYCLE_EXCEEDS_PLAN`, which
 * states the same rule for a booking nobody has made yet and advises against
 * booking it. Its two cycle words are written into each locale's sentence
 * rather than interpolated, because the direction is determined:
 * `bundleCycleFitsPlan` refuses only a yearly bundle beside a monthly plan.
 * They stay in `params` as data.
 */
export function heldMisfitRefusal(
    misfit: AddOnMisfit,
    held: { bundleName: string; until: string },
    target: { planName: string; billingCycle: BillingCycle },
): BundleBookingRefusal {
    const { bundleName, until } = held;
    if (misfit === 'longer-rhythm') {
        return {
            code: BILLING_ERROR_CODES.BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE,
            message:
                `${bundleName} is billed yearly and runs until ${until} at the earliest, which a ` +
                'monthly plan cannot carry. Once it is cancelled, a change that takes effect on or ' +
                'after that day goes through — or keep the yearly cycle.',
            params: {
                billingCycle: 'yearly',
                planCycle: target.billingCycle.toLowerCase(),
                until,
                bundleName,
            },
        };
    }
    return {
        code: BILLING_ERROR_CODES.BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN,
        message:
            `${bundleName} cannot run on ${target.planName} and runs until ${until} at the ` +
            'earliest. Once it is cancelled, a change that takes effect on or after that day ' +
            'goes through — or choose another plan.',
        params: { bundleName, planName: target.planName, until },
    };
}

/**
 * What the early switch to a retirement's replacement says about an add-on
 * running today that cannot run beside the replacement's plan. The switch
 * moves today and has no other plan to offer, so the way past it is the
 * add-on ending: cancelled, the switch can be made from the day it ends.
 */
export function heldBlocksTheSwitch(
    held: { bundleName: string; until: string },
    planName: string,
): BundleBookingRefusal {
    const { bundleName, until } = held;
    return {
        code: BILLING_ERROR_CODES.RETIREMENT_SWITCH_BUNDLE_CANNOT_FOLLOW,
        message:
            `${bundleName} cannot run on ${planName} and runs until ${until} at the earliest. ` +
            'Once it is cancelled, the switch can be made from that day.',
        params: { bundleName, planName, until },
    };
}

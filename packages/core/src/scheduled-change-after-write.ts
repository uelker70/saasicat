// What a plan change leaves of the change a subscription has scheduled. One
// rule for every adapter: the write decides nothing of its own here, it carries
// out what `ImmediatePlanChangeInput.keepsPendingChange` asks for.

/** A scheduled change as a subscription row holds it. */
export interface ScheduledChangeColumns {
    readonly pendingPlan: string | null;
    readonly pendingBillingCycle: string | null;
    readonly pendingEffectiveAt: Date | null;
    readonly pendingChangeVersionId: string | null;
}

/** No change scheduled: what a plan change writes where it does not keep one. */
export const NO_SCHEDULED_CHANGE: ScheduledChangeColumns = {
    pendingPlan: null,
    pendingBillingCycle: null,
    pendingEffectiveAt: null,
    pendingChangeVersionId: null,
};

/**
 * The scheduled-change columns a plan change writes onto `current`: all
 * cleared, unless the write keeps the change. A kept change is left as it is,
 * with one exception: a change that only moves the rhythm on the plan being
 * left — the plan it was scheduled on, no version named — follows the
 * subscription to its new plan. Recorded as it was, it would take the
 * subscription back to the plan it left when it comes due.
 */
export function scheduledChangeAfterWrite(
    current: { readonly plan: string } & ScheduledChangeColumns,
    input: { readonly planId: string; readonly keepsPendingChange?: boolean },
): Partial<ScheduledChangeColumns> {
    if (!input.keepsPendingChange) return NO_SCHEDULED_CHANGE;
    const movesOnlyTheRhythm =
        current.pendingPlan === current.plan && current.pendingChangeVersionId === null;
    return movesOnlyTheRhythm && current.plan !== input.planId ? { pendingPlan: input.planId } : {};
}

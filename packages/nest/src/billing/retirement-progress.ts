// How far a retirement has come, counted over what it reached — subscriptions
// for a plan version, bookings for an add-on version (`SC-SUB-033`).

import type { RetirementProgress } from '@saasicat/core';

/** Where one subscription, or one booking, a retirement reached stands now. */
export interface ReachedState {
    /** Still on the version retired. */
    readonly stillOn: boolean;
    /** Ended by its date, so there is nothing to move. */
    readonly endedByTheDate: boolean;
    /** Its notice reached somebody; until then its date is not set (`SC-SUB-036`). */
    readonly told: boolean;
    readonly effectiveAt: Date;
}

/** The states counted, the reminders aside: those are counted from their own notices. */
export function progressOf(
    states: Iterable<ReachedState>,
    now: Date,
): Omit<RetirementProgress, 'reminded'> {
    const progress = { moved: 0, waiting: 0, overdue: 0, ended: 0, notTold: 0 };
    for (const state of states) {
        if (!state.stillOn) progress.moved += 1;
        else if (state.endedByTheDate) progress.ended += 1;
        else if (!state.told) progress.notTold += 1;
        else if (state.effectiveAt > now) progress.waiting += 1;
        else progress.overdue += 1;
    }
    return progress;
}

/** Whether two lists name the same ids, in whatever order. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((id) => right.has(id));
}

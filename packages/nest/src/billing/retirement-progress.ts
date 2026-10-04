// How far a retirement has come, counted over what it reached — subscriptions
// for a plan version, bookings for an add-on version (`SC-SUB-033`).

import type { NotToldReasons, RetirementProgress } from '@saasicat/core';

/** Why a notice not told yet waits (`NotToldReasons`). */
export type WaitReason = keyof NotToldReasons;

/**
 * Whether a notice not told yet can go out, with what it would say; or why it
 * waits. The run sends on it, and the operator's list counts it, so the two
 * never give different answers.
 */
export type NoticeReadiness<T> =
    { readonly ready: T } | { readonly waits: Exclude<WaitReason, 'nobodyYet'> };

/** Where one subscription, or one booking, a retirement reached stands now. */
export interface ReachedState {
    /** Still on the version retired. */
    readonly stillOn: boolean;
    /**
     * Nothing is left to move: it ends by its date — or, an add-on booking, it
     * has ended since while still on the version, and the run moves nothing
     * that has ended (`SC-BUN-053`).
     */
    readonly endsBeforeItMoves: boolean;
    /** Its notice reached somebody; until then its date is not set (`SC-SUB-038`). */
    readonly told: boolean;
    readonly effectiveAt: Date;
    /** Where its notice is not told: why it waits. Unsaid, nothing holds it back. */
    readonly waitsBecause?: WaitReason;
}

/** The states counted, the reminders aside: those are counted from their own notices. */
export function progressOf(
    states: Iterable<ReachedState>,
    now: Date,
): Omit<RetirementProgress, 'reminded'> {
    const progress = { moved: 0, waiting: 0, overdue: 0, ended: 0, notTold: 0 };
    const notToldReasons = { doesNotFit: 0, twelveMonths: 0, noLongerReached: 0, nobodyYet: 0 };
    for (const state of states) {
        if (!state.stillOn) progress.moved += 1;
        else if (state.endsBeforeItMoves) progress.ended += 1;
        else if (!state.told) {
            progress.notTold += 1;
            notToldReasons[state.waitsBecause ?? 'nobodyYet'] += 1;
        } else if (state.effectiveAt > now) progress.waiting += 1;
        else progress.overdue += 1;
    }
    return { ...progress, notToldReasons };
}

/** Why a notice waits, as the operator's list counts it: what holds it back, or nothing. */
export function waitReasonOf<T>(readiness: NoticeReadiness<T>): WaitReason {
    return 'waits' in readiness ? readiness.waits : 'nobodyYet';
}

/** Whether two lists name the same ids, in whatever order. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
    const left = new Set(a);
    const right = new Set(b);
    return left.size === right.size && [...left].every((id) => right.has(id));
}

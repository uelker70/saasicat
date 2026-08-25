// Whether a subscription's cancellation has taken effect.
//
// Declaring a cancellation changes nothing: a subscription cancelled in month
// three of a year runs, is billed and keeps every entitlement until the term
// ends. What ends it is the date it lands on, and until this file existed
// nothing on the entitlement path asked about that date at all — a subscription
// cancelled eight months ago was granted exactly what it was granted while
// active.
//
// The same reading as the renewal decision, deliberately: on a row written
// before `canceledAt` and `canceledEffectiveAt` separated, the first column IS
// the effective date and the second is genuinely null. Two readings of one
// legacy row is how a rule quietly becomes two rules.

/** The two dates a cancellation is recorded in. */
export interface CancellationDates {
    canceledAt: Date | null;
    canceledEffectiveAt: Date | null;
}

/**
 * True once the cancellation has taken effect at `now`.
 *
 * False when none was declared, and false while one is declared but still in
 * the future — that subscription is paid up and keeps everything.
 */
export function cancellationHasLanded(sub: CancellationDates, now: Date): boolean {
    const landedAt = sub.canceledEffectiveAt ?? sub.canceledAt;
    return landedAt !== null && landedAt <= now;
}

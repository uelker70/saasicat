// What opening a billing window writes. One rule for every adapter, and for
// the platform where it has to know what a plan change left behind.

/** The period columns a write opening a window sets. */
export interface PeriodOpenedColumns {
    readonly currentPeriodStart: Date;
    readonly currentPeriodEnd: Date;
    readonly billingAnchorDay: number;
}

/**
 * The columns a write that opens the window from `periodStart` to `periodEnd`
 * sets; `null` where it opens none, and the period and the billing day stay as
 * they are.
 *
 * The day the subscription is billed on is the window's start — derived
 * rather than passed, because a field carrying it could only ever hold this
 * value and would be one more place for the two to disagree. It is written
 * only when a window is opened: a renewal reading its own previous result is
 * exactly the drift the day exists to stop.
 */
export function columnsOfPeriodOpened(
    periodStart: Date | null,
    periodEnd: Date | null,
): PeriodOpenedColumns | null {
    if (!periodStart || !periodEnd) return null;
    return {
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        billingAnchorDay: periodStart.getUTCDate(),
    };
}

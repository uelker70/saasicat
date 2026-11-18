// What a plan change wrote over, written back. One rule for every adapter: the
// write decides nothing of its own here, it restores what the caller read.

import type { ScheduledChangeColumns } from './scheduled-change-after-write.js';

/**
 * The subscription as it stood before a plan change, where the change is put
 * back because the contract it has to come with could not be written
 * (`ImmediatePlanChangeInput.putsBack`, `SC-CHG-025`).
 *
 * A plan change may open a period, set the day the subscription is billed on,
 * make it active and clear the change it had scheduled. Its own input cannot
 * undo any of that — a `null` there means "leave as it is" — so the state read
 * before the change is handed back whole, and written as given.
 */
export interface SubscriptionPutBack {
    readonly status: string;
    readonly currentPeriodStart: Date | null;
    readonly currentPeriodEnd: Date | null;
    /**
     * `null` where the subscription has none, or where the read did not carry
     * it: readers then take the day from the term end. Both shipped adapters
     * read it.
     */
    readonly billingAnchorDay: number | null;
    readonly scheduledChange: ScheduledChangeColumns;
}

/** The columns a put-back writes: each as it was read, nulls included. */
export function columnsPutBack(
    putBack: SubscriptionPutBack,
): Omit<SubscriptionPutBack, 'scheduledChange'> & ScheduledChangeColumns {
    return {
        status: putBack.status,
        currentPeriodStart: putBack.currentPeriodStart,
        currentPeriodEnd: putBack.currentPeriodEnd,
        billingAnchorDay: putBack.billingAnchorDay,
        ...putBack.scheduledChange,
    };
}

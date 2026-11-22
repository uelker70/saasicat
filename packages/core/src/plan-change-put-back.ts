// What a plan change wrote over, written back. One rule for every adapter: the
// write decides nothing of its own here, it restores what the caller read.

import { columnsOfPeriodOpened } from './period-opened.js';
import {
    scheduledChangeAfterWrite,
    type ScheduledChangeColumns,
} from './scheduled-change-after-write.js';

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
    /**
     * The subscription as the change being put back left it
     * (`subscriptionAsChanged`). The put-back claims the row only while every
     * column it writes still holds that: a change scheduled, a period opened or
     * a status set by another request after the change is not written over
     * with what was read before it (`SC-CHG-011`). The plan version is claimed
     * by `ImmediatePlanChangeInput.expectedPlanVersionId`, the cancellation by
     * `expectedCanceledAt`.
     */
    readonly asChanged: PlanChangeColumns;
}

/** The columns of a subscription a plan change writes, and its put-back writes back. */
export interface PlanChangeColumns {
    readonly plan: string;
    readonly billingCycle: string;
    readonly status: string;
    readonly currentPeriodStart: Date | null;
    readonly currentPeriodEnd: Date | null;
    /**
     * `undefined` where the read did not carry the day and the change did not
     * set it: nothing then says what the row holds, and it is not claimed.
     */
    readonly billingAnchorDay: number | null | undefined;
    readonly scheduledChange: ScheduledChangeColumns;
}

/** What of a plan change's input decides the columns it writes (`ImmediatePlanChangeInput`). */
export interface PlanChangeWrite {
    readonly planId: string;
    readonly cycle: string;
    readonly nextStatus: string | null;
    readonly periodStart: Date | null;
    readonly periodEnd: Date | null;
    readonly keepsPendingChange?: boolean;
}

/**
 * The subscription as `change` leaves it, where it stood as `before`: what the
 * change writes, and the rest as it was — by the rules every adapter writes it
 * by (`columnsOfPeriodOpened`, `scheduledChangeAfterWrite`).
 */
export function subscriptionAsChanged(
    before: PlanChangeColumns,
    change: PlanChangeWrite,
): PlanChangeColumns {
    const opened = columnsOfPeriodOpened(change.periodStart, change.periodEnd);
    return {
        plan: change.planId,
        billingCycle: change.cycle,
        status: change.nextStatus ?? before.status,
        currentPeriodStart: opened ? opened.currentPeriodStart : before.currentPeriodStart,
        currentPeriodEnd: opened ? opened.currentPeriodEnd : before.currentPeriodEnd,
        billingAnchorDay: opened ? opened.billingAnchorDay : before.billingAnchorDay,
        scheduledChange: {
            ...before.scheduledChange,
            ...scheduledChangeAfterWrite({ plan: before.plan, ...before.scheduledChange }, change),
        },
    };
}

/** The columns a put-back writes: each as it was read, nulls included. */
export function columnsPutBack(
    putBack: SubscriptionPutBack,
): Omit<SubscriptionPutBack, 'scheduledChange' | 'asChanged'> & ScheduledChangeColumns {
    return {
        status: putBack.status,
        currentPeriodStart: putBack.currentPeriodStart,
        currentPeriodEnd: putBack.currentPeriodEnd,
        billingAnchorDay: putBack.billingAnchorDay,
        ...putBack.scheduledChange,
    };
}

/**
 * The columns a put-back claims the row by: each as the change left it
 * (`SubscriptionPutBack.asChanged`). A billing day nothing says stays
 * `undefined`, and a claim leaves it out.
 */
export function columnsClaimedByPutBack(
    putBack: SubscriptionPutBack,
): Omit<PlanChangeColumns, 'scheduledChange'> & ScheduledChangeColumns {
    const { scheduledChange, ...columns } = putBack.asChanged;
    return { ...columns, ...scheduledChange };
}

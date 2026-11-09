// What follows a failed collection, the day a planned one is collected from,
// and which of them the platform starts of its own (`SC-PRIC-028`,
// `SC-PRIC-101`).
//
// Pure, so the rules are read in one place: the run decides with them, and
// their boundaries are tested without a run.

import type { InvoiceCollectionRecord } from './invoice-collection.types.js';
import { isRetryableCollectionFailure, type PaymentMethodType } from './payment-gateway.types.js';
import { addDaysToDay, type CalendarDay } from './zoned-day.js';

/** How many days after a failure the same payment method is charged once more. */
export const COLLECTION_RETRY_AFTER_DAYS = 7;

/**
 * Whether the payment method a failed attempt charged is charged once more:
 * its reason can pass, and no other attempt of the invoice failed with that
 * payment method. A replacement gets its own second try.
 */
export function isChargedAgain(
    failed: InvoiceCollectionRecord,
    attempts: readonly InvoiceCollectionRecord[],
): boolean {
    if (failed.status !== 'FAILED' || failed.failureReason === null) return false;
    if (!isRetryableCollectionFailure(failed.failureReason)) return false;
    return !attempts.some(
        (other) =>
            other.id !== failed.id &&
            other.status === 'FAILED' &&
            other.paymentMethodId === failed.paymentMethodId,
    );
}

/** The day the same payment method is charged again after a failure on `failedOn`. */
export function chargedAgainOn(failedOn: CalendarDay): CalendarDay {
    return addDaysToDay(failedOn, COLLECTION_RETRY_AFTER_DAYS);
}

/**
 * The day a direct debit announced on `announcedOn` is collected: the lead
 * time after its announcement, and never before `earliest`.
 */
export function announcedCollectionDay(
    earliest: CalendarDay,
    announcedOn: CalendarDay,
    leadDays: number,
): CalendarDay {
    const afterLead = addDaysToDay(announcedOn, leadDays);
    return afterLead > earliest ? afterLead : earliest;
}

/**
 * The day a collection planned from `collectOn` on `today` reaches the
 * account: a card's on that day, or today where that day has passed — a run
 * takes a planned charge up the moment it is due —, a direct debit's the lead
 * time after the announcement it is given today, not before.
 */
export function plannedCollectionReaches(
    type: PaymentMethodType,
    collectOn: CalendarDay,
    today: CalendarDay,
    leadDays: number,
): CalendarDay {
    if (type === 'sepa_debit') return announcedCollectionDay(collectOn, today, leadDays);
    return collectOn > today ? collectOn : today;
}

/**
 * Whether the platform starts, of its own, a collection that reaches the
 * account on `reaches`: only on or before the invoice's due date
 * (`SC-PRIC-101`). After it, nothing is collected but what the subscriber
 * starts — paying now, or entering a payment method.
 */
export function isStartedByThePlatform(reaches: CalendarDay, dueDate: CalendarDay): boolean {
    return reaches <= dueDate;
}

/**
 * The day a tenant is read-only from for an invoice nothing collects by its
 * due date, until it is paid: its due date, or `today` where that is later —
 * a refusal or a reversal learned after it (`SC-PRIC-098`).
 */
export function readOnlyFromFor(dueDate: CalendarDay, today: CalendarDay): CalendarDay {
    return today > dueDate ? today : dueDate;
}

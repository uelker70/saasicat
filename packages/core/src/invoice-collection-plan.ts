// What follows a failed collection, and the day a planned one is collected
// from (`SC-PRIC-028`, `SC-PRIC-080`).
//
// Pure, so the rules are read in one place: the run decides with them, and
// their boundaries are tested without a run.

import type { InvoiceCollectionRecord } from './invoice-collection.types.js';
import { isRetryableCollectionFailure } from './payment-gateway.types.js';
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

// When an open invoice is overdue, and by how much, read in the installation's
// zone (`SC-ADM-044`). The due date is the last day to pay, so an invoice is
// overdue from the day after it.

import type { InvoiceCollectionRecord } from './invoice-collection.types.js';
import { calendarDaysBetween, type CalendarDay } from './zoned-day.js';

/** Whether an invoice due on `dueDate` is overdue on `today`: due before it. */
export function isOverdueOn(dueDate: CalendarDay, today: CalendarDay): boolean {
    return dueDate < today;
}

/** Calendar days an invoice due on `dueDate` is overdue on `today`; `0` while it is not. */
export function daysOverdue(dueDate: CalendarDay, today: CalendarDay): number {
    if (!isOverdueOn(dueDate, today)) return 0;
    return calendarDaysBetween(dueDate, today);
}

/** The latest attempt of each invoice among `attempts`, by invoice id. */
export function latestAttemptsOf(
    attempts: readonly InvoiceCollectionRecord[],
): Map<string, InvoiceCollectionRecord> {
    const latest = new Map<string, InvoiceCollectionRecord>();
    for (const attempt of attempts) {
        const known = latest.get(attempt.invoiceId);
        if (!known || attempt.attempt > known.attempt) latest.set(attempt.invoiceId, attempt);
    }
    return latest;
}

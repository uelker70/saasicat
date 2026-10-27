// When an open invoice is overdue, and by how much, read in the installation's
// zone (`SC-ADM-044`). The due date is the last day to pay, so an invoice is
// overdue from the day after it.

import type { InvoiceCollectionRecord } from './invoice-collection.types.js';
import type { CalendarDay } from './zoned-day.js';

const MS_PER_DAY = 86_400_000;

function utcOf(day: CalendarDay): number {
    const [year, month, date] = day.split('-').map(Number);
    if (!year || !month || !date) throw new RangeError(`${day} is not a day.`);
    return Date.UTC(year, month - 1, date);
}

/** Whether an invoice due on `dueDate` is overdue on `today`: due before it. */
export function isOverdueOn(dueDate: CalendarDay, today: CalendarDay): boolean {
    return dueDate < today;
}

/** Calendar days an invoice due on `dueDate` is overdue on `today`; `0` while it is not. */
export function daysOverdue(dueDate: CalendarDay, today: CalendarDay): number {
    if (!isOverdueOn(dueDate, today)) return 0;
    // Both are midnights in UTC, so the difference is whole days, a change of
    // daylight saving time included.
    return Math.round((utcOf(today) - utcOf(dueDate)) / MS_PER_DAY);
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

// What a payout the operator records sends, read off the form: an amount to
// the cent and no more than is open, a reference that names the transfer, the
// day it left. Framework-free, so the rule is one function the dialog uses and
// a test calls without mounting it.

import { toCents, type AdminSubscriberPayout, type CalendarDay } from '@saasicat/core';

/** The longest reference the platform takes for a payout. */
export const PAYOUT_REFERENCE_MAX_LENGTH = 200;

/** The longest note the platform takes with a payout. */
export const PAYOUT_NOTE_MAX_LENGTH = 500;

/** A day as `YYYY-MM-DD`, as a date input gives it. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The form as the operator fills it in. */
export interface PayoutForm {
    amount: number | null;
    reference: string;
    /** Empty until the operator picks a day. */
    paidOn: CalendarDay;
    note: string;
}

/**
 * The payout the form describes against a credit that still owes `open`, or
 * `null` while it describes none: an amount that is not positive, has a
 * fraction of a cent or exceeds what is open, a blank reference, no day.
 */
export function payoutOf(form: PayoutForm, open: number): AdminSubscriberPayout | null {
    const { amount } = form;
    if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
    if (toCents(amount) / 100 !== amount || toCents(amount) > toCents(open)) return null;
    const reference = form.reference.trim();
    if (reference === '' || reference.length > PAYOUT_REFERENCE_MAX_LENGTH) return null;
    if (!DAY_PATTERN.test(form.paidOn)) return null;
    const note = form.note.trim();
    if (note.length > PAYOUT_NOTE_MAX_LENGTH) return null;
    return { amount, reference, paidOn: form.paidOn, note: note === '' ? null : note };
}

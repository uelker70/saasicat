// What an invoice stands in relation to, by the numbers on the documents —
// what it corrects, what cancelled it and what replaced it — and where its
// payment stands. Worded here once, so the subscriber's record, the register
// and the tenant's list say it alike; the platform decides the standing
// (`invoiceStandingsOf` in core), this only words it.

import type { AdminSubscriberInvoice, CalendarDay, InvoiceReference } from '@saasicat/core';

import { formatMessage } from './i18n/format.js';

/** The sentences the links are worded from, each with the other invoice's `{number}`. */
export interface InvoiceStandingMessages {
    cancellationOf: string;
    replacementOf: string;
    cancelledBy: string;
    replacedBy: string;
}

/**
 * The sentences a payment's standing is worded from: `{day}` is a day,
 * `{owed}`, `{open}` and `{total}` are amounts, each as the page writes them.
 */
export interface InvoicePaymentMessages {
    paymentOpen: string;
    paymentOverdue: string;
    paymentOpenPart: string;
    paymentOverduePart: string;
    paymentReversed: string;
    paymentPaid: string;
    paymentToBeRefunded: string;
    paymentToBeRefundedPart: string;
    paymentRefunded: string;
}

/** How the page writes a day and an amount of the invoice's currency. */
export interface InvoicePaymentWriters {
    day: (day: CalendarDay) => string;
    money: (amount: number) => string;
}

/**
 * `invoice`'s links, joined; empty for an invoice that corrects nothing and
 * stands. A list that does not know what replaced an invoice leaves
 * `replacedBy` out.
 */
export function invoiceStandingOf(
    {
        correction,
        cancelledBy,
        replacedBy = null,
    }: Pick<AdminSubscriberInvoice, 'correction' | 'cancelledBy'> & {
        replacedBy?: InvoiceReference | null;
    },
    messages: InvoiceStandingMessages,
): string {
    const corrects = correction
        ? formatMessage(
              correction.kind === 'cancellation' ? messages.cancellationOf : messages.replacementOf,
              { number: correction.of.number },
          )
        : null;
    const cancelled = cancelledBy
        ? formatMessage(messages.cancelledBy, { number: cancelledBy.number })
        : null;
    const replaced = replacedBy
        ? formatMessage(messages.replacedBy, { number: replacedBy.number })
        : null;
    return [corrects, cancelled, replaced].filter((part) => part !== null).join(' · ');
}

/** Where `invoice`'s payment stands, worded; empty where it is not paid at all. */
export function invoicePaymentOf(
    { payment, totalGross }: Pick<AdminSubscriberInvoice, 'payment' | 'totalGross'>,
    messages: InvoicePaymentMessages,
    write: InvoicePaymentWriters,
): string {
    if (!payment) return '';
    switch (payment.kind) {
        case 'paid':
            return formatMessage(messages.paymentPaid, { day: write.day(payment.on) });
        case 'refunded':
            return formatMessage(messages.paymentRefunded, { day: write.day(payment.on) });
        case 'to-be-refunded':
            return payment.open < -totalGross
                ? formatMessage(messages.paymentToBeRefundedPart, {
                      open: write.money(payment.open),
                      total: write.money(-totalGross),
                  })
                : messages.paymentToBeRefunded;
        case 'reversed':
            return [
                formatMessage(messages.paymentReversed, { day: write.day(payment.on) }),
                owedOf(payment, totalGross, messages, write),
            ].join(' · ');
        case 'open':
            return owedOf(payment, totalGross, messages, write);
    }
}

/** What an invoice still owes: all of it, or a part of its total, and whether it is overdue. */
function owedOf(
    { owed, overdue }: { owed: number; overdue: boolean },
    totalGross: number,
    messages: InvoicePaymentMessages,
    write: InvoicePaymentWriters,
): string {
    if (owed >= totalGross) return overdue ? messages.paymentOverdue : messages.paymentOpen;
    return formatMessage(overdue ? messages.paymentOverduePart : messages.paymentOpenPart, {
        owed: write.money(owed),
        total: write.money(totalGross),
    });
}

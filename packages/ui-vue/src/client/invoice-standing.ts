// What an invoice stands in relation to, by the numbers on the documents:
// what it corrects, and what cancelled it — a replacement can be both. Worded
// here once, so the subscriber's record and the register say it alike.

import type { AdminSubscriberInvoice } from '@saasicat/core';

import { formatMessage } from './i18n/format.js';

/** The sentences the standing is worded from, each with the other invoice's `{number}`. */
export interface InvoiceStandingMessages {
    cancellationOf: string;
    replacementOf: string;
    cancelledBy: string;
}

/** `invoice`'s standing, its parts joined; empty for an invoice that corrects nothing and stands. */
export function invoiceStandingOf(
    { correction, cancelledBy }: Pick<AdminSubscriberInvoice, 'correction' | 'cancelledBy'>,
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
    return [corrects, cancelled].filter((part) => part !== null).join(' · ');
}

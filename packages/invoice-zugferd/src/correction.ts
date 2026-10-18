// translation-catalogue — the sentences below are German on purpose, with
// English beside them.
//
// What a cancellation invoice and a replacement say of the invoice they correct
// (`SC-PRIC-025`, `SC-PRIC-089`), in German and in English, as the page shows it
// and the XML states it: which invoice that is, why it was cancelled, and which
// of its lines each line cancels or replaces.

import type { SubscriptionInvoiceLineRecord, SubscriptionInvoiceRecord } from '@saasicat/core';

import { pageDay } from './format.js';
import { LABELS, type Label } from './labels.js';

/**
 * The sign the XML states the invoice's amounts with. A cancellation invoice
 * records the amounts of the invoice it cancels reversed, so that it and that
 * invoice add up to nothing; EN 16931 states a credit note's amounts as
 * positive, so the XML turns them back.
 */
export function xmlSignOf(invoice: SubscriptionInvoiceRecord): 1 | -1 {
    return isCancellation(invoice) ? -1 : 1;
}

/** Whether the invoice is a cancellation invoice. */
export function isCancellation(invoice: SubscriptionInvoiceRecord): boolean {
    return invoice.correction?.kind === 'cancellation';
}

/** What the document is called: a cancellation invoice is "Stornorechnung" (`SC-PRIC-089`). */
export function titleOf(invoice: SubscriptionInvoiceRecord): Label {
    return isCancellation(invoice) ? LABELS.cancellationTitle : LABELS.title;
}

/** What the invoice says of the invoice it corrects; `null` where it corrects none. */
export function correctionNoteOf(invoice: SubscriptionInvoiceRecord): Label | null {
    const { correction } = invoice;
    if (!correction) return null;
    const number = correction.of.number;
    const day = pageDay(correction.of.issueDate);
    if (correction.kind === 'cancellation') {
        return {
            de: `Storniert die Rechnung ${number} vom ${day}. Grund: ${correction.reason}`,
            en: `Cancels invoice ${number} of ${day}. Reason: ${correction.reason}`,
        };
    }
    return {
        de: `Ersetzt die Rechnung ${number} vom ${day}. Grund der Stornierung: ${correction.reason}`,
        en: `Replaces invoice ${number} of ${day}. Reason for the cancellation: ${correction.reason}`,
    };
}

/** Which line of the corrected invoice `line` cancels or replaces; `null` where it corrects none. */
export function lineCorrectionOf(
    invoice: SubscriptionInvoiceRecord,
    line: SubscriptionInvoiceLineRecord,
): Label | null {
    const { correction } = invoice;
    if (!correction || line.correctedPosition === null) return null;
    // The invoice it corrects is named once, at the head of the document.
    const position = line.correctedPosition;
    return correction.kind === 'cancellation'
        ? { de: `Storniert Pos. ${position}`, en: `Cancels item ${position}` }
        : { de: `Ersetzt Pos. ${position}`, en: `Replaces item ${position}` };
}

/**
 * How a cancellation invoice is paid: it is not. It annuls the invoice it
 * cancels, so it asks for nothing and pays nothing out on its own.
 */
export function cancellationPaymentNoteOf(invoice: SubscriptionInvoiceRecord): Label | null {
    const { correction } = invoice;
    if (correction?.kind !== 'cancellation') return null;
    return {
        de: `Nichts zu zahlen: Diese Stornorechnung hebt die Rechnung ${correction.of.number} auf.`,
        en: `Nothing to pay: this cancellation invoice annuls invoice ${correction.of.number}.`,
    };
}

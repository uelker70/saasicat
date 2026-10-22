// The cancellation of an invoice as the tenant page asks for it: which
// invoices it is offered at, what the operator may say of each line, and the
// request an operator's input makes.
//
// The platform refuses a cancellation invoice and an invoice cancelled
// already with codes of their own; the page offers neither, so the operator
// is not sent into a dialog that can only end in a refusal. Everything else
// that refuses one — a document not archived, an invoice stating a credit —
// is the preview's to say.

import {
    INVOICE_SUBSCRIBER_DETAILS,
    type AdminInvoiceLine,
    type AdminTenantInvoice,
    type InvoiceCancellationRequest,
    type InvoiceLineOwed,
    type InvoiceSubscriberDetail,
} from '@saasicat/core';

/** Whether `invoice` stands and is no cancellation invoice, so it can be cancelled. */
export function isCancellable(
    invoice: Pick<AdminTenantInvoice, 'correction' | 'cancelledBy'>,
): boolean {
    return invoice.cancelledBy === null && invoice.correction?.kind !== 'cancellation';
}

/** What the operator says of a line: owed in full, not owed, or owed in part. */
export type InvoiceLineChoice = 'owed' | 'not-owed' | 'part';

/** A line the operator chose for; `amount` is what is still owed, net, of one owed in part. */
export interface InvoiceLineEntry {
    choice: InvoiceLineChoice;
    /** `null` until an amount is entered. */
    amount: number | null;
}

/**
 * What the operator has entered. A detail of the subscriber is absent where
 * it stays as the invoice names it, text where it is corrected, and `null`
 * where the replacement names none — taken over from a record that holds none.
 * A line is absent, or chosen as owed, where it is owed in full; the request
 * leaves it out, as the cancellation reads a line owed in full.
 */
export interface InvoiceCancellationDraft {
    reason: string;
    deliverTo: string;
    corrections: Partial<Record<InvoiceSubscriberDetail, string | null>>;
    /** By the line's position on the document. */
    lines: Partial<Record<number, InvoiceLineEntry>>;
}

/** A draft with nothing entered. */
export function emptyCancellationDraft(): InvoiceCancellationDraft {
    return { reason: '', deliverTo: '', corrections: {}, lines: {} };
}

/** Whether `draft` says why, which the platform asks of every cancellation. */
export function givesAReason(draft: Pick<InvoiceCancellationDraft, 'reason'>): boolean {
    return draft.reason.trim() !== '';
}

/**
 * Whether `draft` can be asked about: it says why, and each line owed in part
 * says how much. Whether that amount fits the line is the cancellation's to
 * say, against what the line stands at.
 */
export function isAskable(draft: Pick<InvoiceCancellationDraft, 'reason' | 'lines'>): boolean {
    return (
        givesAReason(draft) &&
        Object.values(draft.lines).every(
            (entry) => entry?.choice !== 'part' || entry.amount !== null,
        )
    );
}

/**
 * Why a line offers no choice: a discount follows what it reduced, a
 * correction's line corrects another, and anything else asks for nothing — a
 * credit, or a charge an earlier cancellation took to nothing.
 */
export function whyNotCorrectable(
    line: Pick<AdminInvoiceLine, 'origin' | 'source'>,
): 'discount' | 'correction' | 'nothing' {
    if (line.origin === 'correction') return 'correction';
    if (line.source === 'discount') return 'discount';
    return 'nothing';
}

/** The lines `draft` names, by position: not owed as nothing, owed in part as entered. */
function linesOwedOf(lines: InvoiceCancellationDraft['lines']): InvoiceLineOwed[] {
    const named: InvoiceLineOwed[] = [];
    for (const [position, entry] of Object.entries(lines)) {
        if (!entry || entry.choice === 'owed') continue;
        if (entry.choice === 'not-owed') named.push({ position: Number(position), owed: 0 });
        else if (entry.amount !== null) {
            named.push({ position: Number(position), owed: entry.amount });
        }
    }
    return named;
}

/**
 * The request `draft` makes, each text trimmed: an address of nothing is none
 * given, and a detail typed as nothing stays as it was.
 */
export function cancellationRequestOf(draft: InvoiceCancellationDraft): InvoiceCancellationRequest {
    const corrections: Partial<Record<InvoiceSubscriberDetail, string | null>> = {};
    for (const detail of INVOICE_SUBSCRIBER_DETAILS) {
        const value = draft.corrections[detail];
        if (value === undefined) continue;
        if (value === null) corrections[detail] = null;
        else if (value.trim() !== '') corrections[detail] = value.trim();
    }
    const deliverTo = draft.deliverTo.trim();
    const request: InvoiceCancellationRequest = {
        reason: draft.reason.trim(),
        deliverTo: deliverTo === '' ? null : deliverTo,
    };
    if (Object.keys(corrections).length > 0) request.corrections = corrections;
    const lines = linesOwedOf(draft.lines);
    if (lines.length > 0) request.lines = lines;
    return request;
}

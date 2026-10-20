// The cancellation of an invoice as the tenant page asks for it: which
// invoices it is offered at, and the request an operator's input makes.
//
// The platform refuses a cancellation invoice and an invoice cancelled
// already with codes of their own; the page offers neither, so the operator
// is not sent into a dialog that can only end in a refusal. Everything else
// that refuses one — a document not archived, an invoice stating a credit —
// is the preview's to say.

import {
    INVOICE_SUBSCRIBER_DETAILS,
    type AdminTenantInvoice,
    type InvoiceCancellationRequest,
    type InvoiceSubscriberDetail,
} from '@saasicat/core';

/** Whether `invoice` stands and is no cancellation invoice, so it can be cancelled. */
export function isCancellable(
    invoice: Pick<AdminTenantInvoice, 'correction' | 'cancelledBy'>,
): boolean {
    return invoice.cancelledBy === null && invoice.correction?.kind !== 'cancellation';
}

/**
 * What the operator has entered. A detail of the subscriber is absent where
 * it stays as the invoice names it, text where it is corrected, and `null`
 * where the replacement names none — taken over from a record that holds none.
 */
export interface InvoiceCancellationDraft {
    reason: string;
    deliverTo: string;
    corrections: Partial<Record<InvoiceSubscriberDetail, string | null>>;
}

/** A draft with nothing entered. */
export function emptyCancellationDraft(): InvoiceCancellationDraft {
    return { reason: '', deliverTo: '', corrections: {} };
}

/** Whether `draft` says why, which the platform asks of every cancellation. */
export function givesAReason(draft: Pick<InvoiceCancellationDraft, 'reason'>): boolean {
    return draft.reason.trim() !== '';
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
    return request;
}

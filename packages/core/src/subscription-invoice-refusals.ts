import { INVOICE_ERROR_CODES } from './error-codes.js';
import { PersistenceRefusal } from './errors.js';

/**
 * A charge that already stands on an invoice: what the unique `chargeId` of
 * the invoice lines answers when two runs issue the same charges at once. The
 * invoice is not written and its number not drawn.
 */
export function subscriptionInvoiceChargeInvoiced(chargeId: string): PersistenceRefusal {
    return new PersistenceRefusal(
        INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_CHARGE_INVOICED,
        'moved',
        `Charge '${chargeId}' already stands on an invoice.`,
        { chargeId },
    );
}

/**
 * The invoice is cancelled already: of two cancellations at once, the second
 * meets the first (`SC-PRIC-036`). Nothing is written and no number is drawn.
 */
export function subscriptionInvoiceAlreadyCancelled(number: string): PersistenceRefusal {
    return new PersistenceRefusal(
        INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_ALREADY_CANCELLED,
        'moved',
        `Invoice ${number} is cancelled already.`,
        { number },
    );
}

/**
 * A rendering of an invoice's document whose checksum is not the one recorded
 * or archived for it, refused: the first stays. Only the run replaces a
 * recorded rendering, and only while nothing is archived (`SC-AUD-019`).
 */
export function subscriptionInvoiceDocumentChanged(
    invoiceId: string,
    recorded: string,
    rendered: string,
): PersistenceRefusal {
    return new PersistenceRefusal(
        INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED,
        'moved',
        `The document rendered for invoice '${invoiceId}' differs from the one recorded for it.`,
        { invoiceId, recorded, rendered },
    );
}

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

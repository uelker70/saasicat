import type { SubscriptionInvoiceRecord, SubscriptionInvoiceRepository } from '@saasicat/core';

/**
 * The address given with the cancellation an invoice is the cancellation
 * invoice or the replacement of, or `null` where it is neither or none was
 * given (`SC-PRIC-094`). Asked of the invoice it corrects, whose own
 * cancellation a store answers first: a replacement cancelled in turn still
 * belongs to the cancellation that issued it.
 */
export async function addressGivenFor(
    invoices: SubscriptionInvoiceRepository,
    invoice: SubscriptionInvoiceRecord,
): Promise<string | null> {
    if (!invoice.correction) return null;
    const cancellation = await invoices.findCancellation(invoice.correction.of.invoiceId);
    return cancellation?.deliverTo ?? null;
}

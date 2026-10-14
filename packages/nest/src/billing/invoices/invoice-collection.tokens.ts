/** Adapter token: where invoices' collection attempts are kept (`chargeJournal.invoices.collections`). */
export const INVOICE_COLLECTION_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/InvoiceCollectionRepository',
);

/**
 * Adapter token: where what the subscriber is told about collecting an invoice
 * is recorded (`chargeJournal.invoices.notices`) — the record of subscriber
 * notices, so each is sent once.
 */
export const INVOICE_COLLECTION_NOTICE_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/InvoiceCollectionNoticeRepository',
);

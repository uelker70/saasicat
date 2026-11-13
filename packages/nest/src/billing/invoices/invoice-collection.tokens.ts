/** Adapter token: where invoices' collection attempts are kept (`chargeJournal.invoices.collections`). */
export const INVOICE_COLLECTION_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/InvoiceCollectionRepository',
);

/**
 * Adapter token: where the payments the gateway confirmed, the credits and
 * what pays them out are kept (`chargeJournal.invoices.payments`).
 */
export const SUBSCRIBER_PAYMENT_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/SubscriberPaymentRepository',
);

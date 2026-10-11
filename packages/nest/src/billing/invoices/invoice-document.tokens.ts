/** Adapter token: what renders an invoice into its file (`chargeJournal.invoices.renderer`). */
export const INVOICE_RENDERER_TOKEN = Symbol.for('saasicat/nest/InvoiceRenderer');

/** Adapter token: where invoices' documents are kept (`chargeJournal.invoices.archive`). */
export const INVOICE_ARCHIVE_TOKEN = Symbol.for('saasicat/nest/InvoiceArchivePort');

/** Adapter token: how an invoice reaches the subscriber (`chargeJournal.invoices.mail`). */
export const INVOICE_MAIL_PORT_TOKEN = Symbol.for('saasicat/nest/InvoiceMailPort');

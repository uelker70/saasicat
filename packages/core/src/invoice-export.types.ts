// The export of the invoice register for a tax advisor (`SC-ADM-043`): the
// invoices of a span of months as of a stated moment, their lines with their tax
// treatment and rate, and the settlements against each, every one with the
// moment it was recorded. One model, from which the CSV tables and `export.json`
// are both written, so the two cannot disagree.
// Wire format: @saasicat/spec/schemas/invoice-export.schema.json, from which the
// model, its rows and the manifest are generated.

import type { SubscriptionInvoiceDocumentRecord } from './invoice-document.types.js';
import type { RegisteredInvoice } from './invoice-register.types.js';
import type { InvoiceSettlementKind } from './subscriber-payment-mapping.js';
import type { SubscriptionInvoiceCancellationRecord } from './subscription-invoice.types.js';

export type {
    InvoiceExport,
    InvoiceExportInvoiceRow,
    InvoiceExportLineRow,
    InvoiceExportManifest,
    InvoiceExportSettlementRow,
} from './generated/invoice-export.gen.js';

/** The shape `export.json` and the CSV tables have; raised when a column changes meaning. */
export const INVOICE_EXPORT_FORMAT_VERSION = 1;

/**
 * How long before a request the moment an export is as of may reach at the
 * latest. A store stamps what it records with the start of the transaction
 * that writes it, so a transaction begun before a moment and committed after an
 * export was taken would add rows to a later export as of the same moment; five
 * minutes outlast every transaction the platform runs.
 */
export const INVOICE_EXPORT_SETTLE_MS = 5 * 60_000;

/** The languages an export's CSV is written in: the separators and the decimal mark. */
export const INVOICE_EXPORT_LOCALES = ['de', 'en'] as const;
export type InvoiceExportLocale = (typeof INVOICE_EXPORT_LOCALES)[number];

/** A settlement against an invoice, with the payment and the reversal it came from. */
export interface InvoiceSettlementRecord {
    id: string;
    invoiceId: string;
    kind: InvoiceSettlementKind;
    /** As recorded, never negative; what it does to what the invoice owes is its kind's. */
    amount: number;
    recordedAt: Date;
    payment: { id: string; provider: string; gatewayAccount: string; gatewayRef: string };
    /** The reversal it records or reinstates; `null` for any other kind. */
    reversal: { id: string; gatewayRef: string } | null;
    /** The cancellation that moved it out of or into an invoice; `null` otherwise. */
    cancellationId: string | null;
}

/** What a store reads for an export, before the moment it is as of is applied. */
export interface InvoiceExportSource {
    /**
     * Issued on the days of the span, whenever, as the register reads them: by
     * issue date and number, each with the cancellation invoice that cancelled
     * it, whenever that was issued.
     */
    invoices: RegisteredInvoice[];
    /**
     * Every cancellation any of them takes part in, whenever recorded; one
     * that joins two of them may be named twice.
     */
    cancellations: SubscriptionInvoiceCancellationRecord[];
    /** Every settlement against any of them, whenever recorded. */
    settlements: InvoiceSettlementRecord[];
    /** The documents of those that have one, archived or not. */
    documents: SubscriptionInvoiceDocumentRecord[];
}

/** A file of the archive, before the manifest names its size and SHA-256. */
export interface InvoiceExportFile {
    name: string;
    content: string;
}

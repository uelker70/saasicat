// The export of the invoice register for a tax advisor (`SC-ADM-043`): the
// invoices of a span of months as of a stated moment, their lines with their tax
// treatment and rate, and the settlements against each, every one with the
// moment it was recorded. One model, from which the CSV tables and `export.json`
// are both written, so the two cannot disagree.

import type { SubscriptionInvoiceDocumentRecord } from './invoice-document.types.js';
import type { CalendarMonth, RegisteredInvoice } from './invoice-register.types.js';
import type { InvoiceSettlementKind } from './subscriber-payment-mapping.js';
import type { SubscriptionInvoiceCancellationRecord } from './subscription-invoice.types.js';
import type { TaxTreatmentKind } from './tax.types.js';
import type { CalendarDay, LocalMoment } from './zoned-day.js';

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
    /** Every cancellation any of them takes part in, whenever recorded. */
    cancellations: SubscriptionInvoiceCancellationRecord[];
    /** Every settlement against any of them, whenever recorded. */
    settlements: InvoiceSettlementRecord[];
    /** The documents of those that have one, archived or not. */
    documents: SubscriptionInvoiceDocumentRecord[];
}

/** One invoice as the export lists it. */
export interface InvoiceExportInvoiceRow {
    invoiceId: string;
    number: string;
    /** An invoice, the cancellation invoice that cancels one, or the replacement for one. */
    kind: 'invoice' | 'cancellation' | 'replacement';
    /** The number of the invoice it cancels or replaces; `null` for an invoice. */
    corrects: string | null;
    issueDate: CalendarDay;
    /** ISO 8601, UTC. */
    issuedAt: string;
    dueDate: CalendarDay;
    servicePeriodFrom: CalendarDay;
    servicePeriodUntil: CalendarDay;
    currency: string;
    totalNet: number;
    totalTax: number;
    totalGross: number;
    taxTreatment: TaxTreatmentKind;
    /** The rate the treatment names, in percent. */
    taxRate: number;
    /** The sentence the document carries for the treatment; `null` where none. */
    taxNote: string | null;
    subscriberId: string;
    tenantId: string;
    customerNumber: string;
    legalName: string;
    vatId: string | null;
    taxNumber: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    /** The cancellation invoice that cancelled it by the moment the export is as of; `null` while none had. */
    cancelledBy: string | null;
    /** ISO 8601, UTC; when that cancellation was recorded. */
    cancelledAt: string | null;
    /** SHA-256 of the archived document; `null` while it awaited its archive at that moment. */
    documentChecksum: string | null;
    /** ISO 8601, UTC; when the archive confirmed it. */
    documentArchivedAt: string | null;
    documentFileName: string | null;
}

/** One line of an invoice as the export lists it. */
export interface InvoiceExportLineRow {
    invoiceId: string;
    invoiceNumber: string;
    position: number;
    title: string;
    origin: string;
    source: string;
    periodFrom: CalendarDay;
    periodUntil: CalendarDay;
    amountNet: number;
    taxTreatment: TaxTreatmentKind;
    taxRate: number;
    /** The position of the line it corrects on the invoice it corrects; `null` otherwise. */
    correctsPosition: number | null;
}

/** One settlement as the export lists it. */
export interface InvoiceExportSettlementRow {
    settlementId: string;
    invoiceId: string;
    invoiceNumber: string;
    kind: InvoiceSettlementKind;
    /** As recorded, never negative. */
    amount: number;
    currency: string;
    /** ISO 8601, UTC. */
    recordedAt: string;
    paymentId: string;
    provider: string;
    gatewayAccount: string;
    /** The gateway's reference of the payment. */
    paymentReference: string;
    /** The gateway's reference of the reversal; `null` for a kind that records none. */
    reversalReference: string | null;
    /** The number of the invoice whose cancellation moved it; `null` otherwise. */
    cancellationOf: string | null;
}

/** What an export holds: its period, the moment it is as of, and its three tables. */
export interface InvoiceExport {
    formatVersion: typeof INVOICE_EXPORT_FORMAT_VERSION;
    period: { from: CalendarMonth; until: CalendarMonth };
    /** ISO 8601, UTC, to the second. */
    asOf: string;
    /** The same moment as a clock in the installation's zone shows it. */
    asOfLocal: LocalMoment;
    timeZone: string;
    invoices: InvoiceExportInvoiceRow[];
    lines: InvoiceExportLineRow[];
    settlements: InvoiceExportSettlementRow[];
}

/** A file of the archive and what the manifest records of it. */
export interface InvoiceExportFile {
    name: string;
    content: string;
}

/** What the manifest names: the export, how its CSV is written, and every file's SHA-256. */
export interface InvoiceExportManifest {
    formatVersion: typeof INVOICE_EXPORT_FORMAT_VERSION;
    period: { from: CalendarMonth; until: CalendarMonth };
    asOf: string;
    asOfLocal: LocalMoment;
    timeZone: string;
    locale: InvoiceExportLocale;
    csv: {
        delimiter: string;
        decimalSeparator: string;
        encoding: 'UTF-8, with a byte order mark';
        lineEnding: 'CRLF';
    };
    counts: { invoices: number; lines: number; settlements: number };
    files: { name: string; bytes: number; sha256: string }[];
}

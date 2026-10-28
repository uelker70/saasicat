// AUTO-GENERATED — do not edit manually.
//
// Source: @saasicat/spec/schemas/invoice-export.schema.json
// Regenerate: `pnpm --filter @saasicat/core gen:types`
// Drift gate: tests/codegen-drift.test.js fails the PR when the schema and
// the generated output diverge.

/**
 * A calendar day in the installation's time zone, `YYYY-MM-DD`.
 */
export type InvoiceExportDay = string;
/**
 * What a tax treatment is, in the words every tax adapter shares. standard and reduced: the issuer's country taxes the charge at a rate. exempt: the charge is exempt there. reverse-charge: the subscriber, a business in another country, owes the tax instead of the issuer. not-taxable: the charge is not taxable in the issuer's country at all. small-business: the issuer charges no tax under a small business scheme.
 */
export type InvoiceExportTaxTreatment =
    'standard' | 'reduced' | 'exempt' | 'reverse-charge' | 'not-taxable' | 'small-business';
/**
 * What a settlement does to what its invoice owes. PAYMENT settles it; REVERSAL opens it again for what a reversal took back; REINSTATEMENT settles it again for what a reversal gave back; MOVED_OUT takes a payment's share off an invoice its cancellation cancelled; MOVED_IN puts it on the replacement.
 */
export type InvoiceExportSettlementKind =
    'PAYMENT' | 'REVERSAL' | 'REINSTATEMENT' | 'MOVED_OUT' | 'MOVED_IN';

/**
 * The export of the invoice register for a tax advisor, as `export.json` in the archive holds it: the invoices issued in a span of months as of a stated moment, their lines with their tax treatment and rate, and the settlements against each with the moment it was recorded. As of a moment means: the invoices issued by then, the settlements and cancellations recorded by then — after the period ended too — and a document's checksum where the archive had confirmed it by then. The same months as of the same moment give the same rows. The CSV tables of the archive hold the same rows, column for column; `manifest.json` follows `#/$defs/InvoiceExportManifest`.
 */
export interface InvoiceExport {
    /**
     * The shape this file and the CSV tables have; raised when a column changes meaning.
     */
    formatVersion: 1;
    period: InvoiceExportPeriod;
    /**
     * The moment the export is as of, ISO 8601 in UTC, to the second.
     */
    asOf: string;
    /**
     * The same moment as a clock in the installation's time zone shows it, `YYYY-MM-DDTHH:MM:SS`.
     */
    asOfLocal: string;
    /**
     * The installation's time zone, an IANA name; the days of the export are its days.
     */
    timeZone: string;
    /**
     * By issue date, then by number.
     */
    invoices: InvoiceExportInvoiceRow[];
    /**
     * In the order of their invoices, each invoice's by position.
     */
    lines: InvoiceExportLineRow[];
    /**
     * In the order of their invoices, each invoice's by when it was recorded.
     */
    settlements: InvoiceExportSettlementRow[];
}
/**
 * The months the export covers, both included, `YYYY-MM`: the invoices issued on their days.
 */
export interface InvoiceExportPeriod {
    from: string;
    until: string;
}
/**
 * One invoice as the export lists it, with the parties as the invoice names them.
 */
export interface InvoiceExportInvoiceRow {
    invoiceId: string;
    /**
     * The number on the invoice.
     */
    number: string;
    /**
     * An invoice, the cancellation invoice that cancels one, or the replacement for one.
     */
    kind: 'invoice' | 'cancellation' | 'replacement';
    /**
     * The number of the invoice it cancels or replaces; null for an invoice.
     */
    corrects: string | null;
    issueDate: InvoiceExportDay;
    /**
     * When it was issued, ISO 8601 in UTC.
     */
    issuedAt: string;
    dueDate: InvoiceExportDay;
    servicePeriodFrom: InvoiceExportDay;
    servicePeriodUntil: InvoiceExportDay;
    /**
     * ISO 4217.
     */
    currency: string;
    totalNet: number;
    totalTax: number;
    totalGross: number;
    taxTreatment: InvoiceExportTaxTreatment;
    /**
     * The rate the treatment names, in percent.
     */
    taxRate: number;
    /**
     * The sentence the document carries for the treatment; null where none.
     */
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
    /**
     * ISO 3166-1 alpha-2.
     */
    country: string | null;
    /**
     * The number of the cancellation invoice that cancelled it by the moment the export is as of; null while none had.
     */
    cancelledBy: string | null;
    /**
     * When that cancellation was recorded, ISO 8601 in UTC.
     */
    cancelledAt: string | null;
    /**
     * The SHA-256 of the archived document, in hex; null while it awaited its archive at that moment.
     */
    documentChecksum: string | null;
    /**
     * When the archive confirmed it, ISO 8601 in UTC.
     */
    documentArchivedAt: string | null;
    documentFileName: string | null;
}
/**
 * One line of an invoice as the export lists it.
 */
export interface InvoiceExportLineRow {
    invoiceId: string;
    invoiceNumber: string;
    /**
     * From 1, as the document numbers it.
     */
    position: number;
    title: string;
    /**
     * What made the charge behind the line arise, as `subscriber-ledger.schema.json` names it.
     */
    origin: string;
    /**
     * Which kind of contract line the charge realises, as `subscriber-ledger.schema.json` names it.
     */
    source: string;
    periodFrom: InvoiceExportDay;
    periodUntil: InvoiceExportDay;
    amountNet: number;
    taxTreatment: InvoiceExportTaxTreatment;
    /**
     * In percent.
     */
    taxRate: number;
    /**
     * The position of the line it corrects on the invoice it corrects; null otherwise.
     */
    correctsPosition: number | null;
}
/**
 * One settlement against an invoice as the export lists it, with the payment and the reversal it came from.
 */
export interface InvoiceExportSettlementRow {
    settlementId: string;
    invoiceId: string;
    invoiceNumber: string;
    kind: InvoiceExportSettlementKind;
    /**
     * As recorded, never negative; what it does to what the invoice owes is its kind's.
     */
    amount: number;
    /**
     * The invoice's, ISO 4217.
     */
    currency: string;
    /**
     * When it was recorded, ISO 8601 in UTC.
     */
    recordedAt: string;
    paymentId: string;
    /**
     * The payment gateway that reported the payment.
     */
    provider: string;
    gatewayAccount: string;
    /**
     * The gateway's reference of the payment.
     */
    paymentReference: string;
    /**
     * The gateway's reference of the reversal; null for a kind that records none.
     */
    reversalReference: string | null;
    /**
     * The number of the invoice whose cancellation moved it; null otherwise.
     */
    cancellationOf: string | null;
}

/**
 * What `manifest.json`, the archive's last file, holds: the export, how its CSV is written, and the size and SHA-256 of every file before it.
 */
export interface InvoiceExportManifest {
    formatVersion: 1;
    period: InvoiceExportPeriod;
    asOf: string;
    asOfLocal: string;
    timeZone: string;
    /**
     * The language the CSV tables are written in: their separators and decimal mark.
     */
    locale: 'de' | 'en';
    csv: {
        delimiter: string;
        decimalSeparator: string;
        encoding: 'UTF-8, with a byte order mark';
        lineEnding: 'CRLF';
    };
    counts: {
        invoices: number;
        lines: number;
        settlements: number;
    };
    /**
     * Every file before the manifest, in the order the archive holds them.
     */
    files: {
        name: string;
        bytes: number;
        sha256: string;
    }[];
}

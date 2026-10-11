// The document an invoice is issued as, where it is kept, and how it reaches
// the subscriber.
//
// An invoice is rendered from what it records and nothing else — never the
// current time or today's settings — into the one file its tax adapter's law
// requires (`SC-PRIC-042`). The file's checksum is recorded with the invoice
// before the file is archived, the archive keeps it under the invoice, and
// every later download returns that file, checked against the checksum
// (`SC-AUD-014`, `SC-AUD-019`). Until the archive confirms, the invoice is
// neither sent nor offered, and an interrupted attempt is repeated
// (`SC-PRIC-033`): as the same write, or — where the renderer has changed
// meanwhile and nothing was archived — with the new file in place of the one
// recorded. Once archived, it is mailed to the subscriber's invoice email with
// the file attached (`SC-PRIC-047`).

import type { SubscriptionInvoiceRecord } from './subscription-invoice.types.js';

/**
 * The manifest capability that announces the operator's download of an
 * invoice's archived document. The platform sets it where it serves the route.
 */
export const INVOICE_DOCUMENT_CAPABILITY = 'invoices.read';

/** A rendered invoice: its bytes, as a file. */
export interface InvoiceDocument {
    content: Uint8Array;
    /** `application/pdf` for a ZUGFeRD invoice. */
    mediaType: string;
    /** What a person saving it would call it, such as `AHP-2026-000123.pdf`. */
    fileName: string;
}

/**
 * Renders an invoice into the file the tax adapter's law requires — the
 * application's own renderer, or the default one SaaSiCat ships.
 *
 * Given the invoice as it was issued, it renders the same bytes every time, so
 * a repeated attempt archives the file whose checksum was recorded. Whatever
 * it would take from the clock, such as a PDF's creation date, it takes from
 * the invoice's `issuedAt`. A renderer updated between two attempts renders
 * other bytes; while nothing is archived, those take the place of the ones
 * recorded, and the audit log says so (`SC-AUD-019`).
 */
export interface InvoiceRenderer {
    render(invoice: SubscriptionInvoiceRecord): Promise<InvoiceDocument>;
}

/** A document to archive: the file, under its invoice, with the checksum recorded for it. */
export interface InvoiceDocumentToArchive extends InvoiceDocument {
    invoiceId: string;
    /** SHA-256 of `content`, lower-case hex. */
    checksum: string;
    archivedAt: Date;
}

/** A document as the archive hands it back. */
export type ArchivedInvoiceDocument = InvoiceDocumentToArchive;

/**
 * Keeps each invoice's document, unalterable, for as long as the law asks —
 * in Germany 8 years from the end of the calendar year it was issued in, in
 * the European Union. The shipped adapters keep it in the database
 * (`SubscriptionInvoiceArchive`, which refuses every update and delete);
 * object storage with a retention lock is another way to implement it.
 */
export interface InvoiceArchivePort {
    /**
     * Stores the document under its invoice. Storing it again with the same
     * checksum is the same write and changes nothing; another checksum for an
     * invoice already archived is refused with
     * `SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED`, and the first stays.
     */
    store(document: InvoiceDocumentToArchive): Promise<void>;
    /** The document archived under the invoice, or `null` where none is. */
    read(invoiceId: string): Promise<ArchivedInvoiceDocument | null>;
    /**
     * Why the archive would let a document it keeps be changed or removed, or
     * `null` where it would not. Asked when invoices start, which are refused
     * while it names a reason: an archive that is not unalterable keeps no
     * document as the law asks, and would only be found out at an audit.
     */
    protectionProblem(): Promise<string | null>;
}

/** An invoice on its way to the subscriber. */
export interface InvoiceMail {
    invoice: SubscriptionInvoiceRecord;
    /** The invoice email on the subscriber's record. */
    to: string;
    /** The archived file, to attach. */
    document: InvoiceDocument;
}

/**
 * Sends an invoice to the subscriber with its file attached (`SC-PRIC-047`).
 *
 * The application words the message — in the subscriber's language, with a
 * link to the tenant's sign-in rather than to the file itself — and sends it
 * with its own mail infrastructure. It rejects where the message could not be
 * handed on; the platform then shows the failure to the operator, with the
 * rejection's message as the reason and the recipient's address taken out of
 * it, and tries again on the next run. The invoice stays issued either way: delivery is not
 * what makes it an invoice.
 *
 * A run claims the invoice before it calls this, so of several instances one
 * sends it. One that does not answer within a minute holds the invoice for
 * its answer: a late success is recorded, a late failure tried again.
 */
export interface InvoiceMailPort {
    deliver(mail: InvoiceMail): Promise<void>;
}

/** Where an invoice's document stands, as the invoice records it. */
export interface SubscriptionInvoiceDocumentRecord {
    invoiceId: string;
    /** SHA-256 of the rendered file, lower-case hex, recorded before it is archived. */
    checksum: string;
    mediaType: string;
    fileName: string;
    /** In bytes. */
    size: number;
    renderedAt: Date;
    /** When the archive confirmed it; `null` while the invoice waits for its document. */
    archivedAt: Date | null;
    /**
     * When the run that is mailing it took it on; `null` while no run holds it.
     * A claim older than the lease is taken on by the next run.
     */
    deliveryClaimedAt: Date | null;
    /** When it was handed to the mail; `null` until then. */
    deliveredAt: Date | null;
    /** The address it was sent to. */
    deliveredTo: string | null;
}

/** What is recorded of a rendering before its file is archived. */
export type NewInvoiceRendering = Pick<
    SubscriptionInvoiceDocumentRecord,
    'checksum' | 'mediaType' | 'fileName' | 'size' | 'renderedAt'
>;

// Canonical row -> record mapping for an invoice's document: where it stands,
// and the archived file. Pure, and shared by both adapters.
//
// Read defensively for the reason `subscription-invoice-mapping.ts` gives: a
// checksum, a size or a file of the wrong shape fails here, loudly, rather than
// reaching a download as a document nobody can check.

import type {
    ArchivedInvoiceDocument,
    SubscriptionInvoiceDocumentRecord,
} from './invoice-document.types.js';

const DOCUMENTS = 'subscription_invoice_documents';
const ARCHIVE = 'subscription_invoice_archive';

/** A SHA-256 digest as the platform writes it: 64 lower-case hex digits. */
const CHECKSUM = /^[0-9a-f]{64}$/;

/** A `subscription_invoice_documents` row as either adapter reads it back. */
export interface CanonicalSubscriptionInvoiceDocumentRow {
    invoiceId: string;
    checksum: string;
    mediaType: string;
    fileName: string;
    size: unknown;
    renderedAt: Date;
    archivedAt: Date | null;
    deliveryClaimedAt: Date | null;
    deliveredAt: Date | null;
    deliveredTo: string | null;
}

/** A `subscription_invoice_archive` row as either adapter reads it back. */
export interface CanonicalSubscriptionInvoiceArchiveRow {
    invoiceId: string;
    checksum: string;
    mediaType: string;
    fileName: string;
    content: Uint8Array;
    archivedAt: Date;
}

/** Whether `value` is a checksum as the platform records one. */
export function isInvoiceDocumentChecksum(value: unknown): value is string {
    return typeof value === 'string' && CHECKSUM.test(value);
}

export function toSubscriptionInvoiceDocumentRecord(
    row: CanonicalSubscriptionInvoiceDocumentRow,
): SubscriptionInvoiceDocumentRecord {
    if (!isInvoiceDocumentChecksum(row.checksum)) {
        throw new Error(`${DOCUMENTS}.checksum of ${row.invoiceId} is not a SHA-256 digest.`);
    }
    const size = Number(row.size);
    if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error(`${DOCUMENTS}.size of ${row.invoiceId} is not a size in bytes.`);
    }
    return {
        invoiceId: row.invoiceId,
        checksum: row.checksum,
        mediaType: row.mediaType,
        fileName: row.fileName,
        size,
        renderedAt: row.renderedAt,
        archivedAt: row.archivedAt,
        deliveryClaimedAt: row.deliveryClaimedAt,
        deliveredAt: row.deliveredAt,
        deliveredTo: row.deliveredTo,
    };
}

export function toArchivedInvoiceDocument(
    row: CanonicalSubscriptionInvoiceArchiveRow,
): ArchivedInvoiceDocument {
    if (!isInvoiceDocumentChecksum(row.checksum)) {
        throw new Error(`${ARCHIVE}.checksum of ${row.invoiceId} is not a SHA-256 digest.`);
    }
    if (!(row.content instanceof Uint8Array)) {
        throw new Error(`${ARCHIVE}.content of ${row.invoiceId} is not a file.`);
    }
    return {
        invoiceId: row.invoiceId,
        checksum: row.checksum,
        mediaType: row.mediaType,
        fileName: row.fileName,
        // A copy that owns its bytes: a driver's `Buffer` may be a view into a
        // pooled allocation, and a caller handing it on must not see that pool.
        content: new Uint8Array(row.content),
        archivedAt: row.archivedAt,
    };
}

/**
 * The triggers of `subscription_invoice_archive` that keep a document as it
 * was issued (`1.0-an-invoice-document-is-archived.postgres.sql`): one refuses
 * every update and delete of a row, the other every truncate of the table.
 */
export const INVOICE_ARCHIVE_TRIGGERS = [
    'subscription_invoice_archive_is_kept',
    'subscription_invoice_archive_is_not_emptied',
] as const;

/**
 * Why the database archive would let a document be changed, given the
 * triggers that fire on its table, or `null` where both of its own do. Shared
 * by both adapters, which read the enabled triggers from the catalogue.
 *
 * A database created from the fragments by `db push` alone, or a migration run
 * before the table existed, has none: the triggers are SQL the Prisma DSL
 * cannot express.
 */
export function invoiceArchiveProtectionProblem(enabledTriggers: readonly string[]): string | null {
    const missing = INVOICE_ARCHIVE_TRIGGERS.filter((name) => !enabledTriggers.includes(name));
    if (missing.length === 0) return null;
    return (
        `${ARCHIVE} lacks ${missing.join(' and ')}, which keep an archived invoice document as it ` +
        'was issued: run @saasicat/spec/sql/1.0-an-invoice-document-is-archived.postgres.sql ' +
        'after db push, and enable the triggers where they were disabled.'
    );
}

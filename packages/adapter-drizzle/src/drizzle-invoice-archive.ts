import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type {
    ArchivedInvoiceDocument,
    InvoiceArchivePort,
    InvoiceDocumentToArchive,
} from '@saasicat/core';
import {
    invoiceArchiveProtectionProblem,
    subscriptionInvoiceDocumentChanged,
    toArchivedInvoiceDocument,
} from '@saasicat/core';
import { DRIZZLE_DB_TOKEN, type DrizzleClient } from './client.js';
import { subscriptionInvoiceArchive } from './schema.js';
import { triggerNamesOf } from './trigger-names.js';

/**
 * `InvoiceArchivePort` against `subscription_invoice_archive`: one file per
 * invoice, written once. The table's triggers refuse every update, delete and
 * truncate (`1.0-an-invoice-document-is-archived.postgres.sql`), so nothing here
 * changes a file once it is stored.
 */
@Injectable()
export class DrizzleInvoiceArchive implements InvoiceArchivePort {
    constructor(@Inject(DRIZZLE_DB_TOKEN) private readonly db: DrizzleClient) {}

    async store(document: InvoiceDocumentToArchive): Promise<void> {
        // `ON CONFLICT DO NOTHING` on the invoice: a file stored before stays,
        // and the one handed over now is compared with it by its checksum.
        const written = await this.db
            .insert(subscriptionInvoiceArchive)
            .values({
                invoiceId: document.invoiceId,
                checksum: document.checksum,
                mediaType: document.mediaType,
                fileName: document.fileName,
                content: document.content,
                archivedAt: document.archivedAt,
            })
            .onConflictDoNothing({ target: subscriptionInvoiceArchive.invoiceId })
            .returning({ invoiceId: subscriptionInvoiceArchive.invoiceId });
        if (written.length > 0) return;
        const [stored] = await this.db
            .select({ checksum: subscriptionInvoiceArchive.checksum })
            .from(subscriptionInvoiceArchive)
            .where(eq(subscriptionInvoiceArchive.invoiceId, document.invoiceId))
            .limit(1);
        if (stored && stored.checksum !== document.checksum) {
            throw subscriptionInvoiceDocumentChanged(
                document.invoiceId,
                stored.checksum,
                document.checksum,
            );
        }
    }

    async read(invoiceId: string): Promise<ArchivedInvoiceDocument | null> {
        const [row] = await this.db
            .select()
            .from(subscriptionInvoiceArchive)
            .where(eq(subscriptionInvoiceArchive.invoiceId, invoiceId))
            .limit(1);
        return row ? toArchivedInvoiceDocument(row) : null;
    }

    async protectionProblem(): Promise<string | null> {
        // Enabled is `O`, as triggers fire by default, or `A`, always; `D` is
        // disabled, and `R` fires only in a session that replicates.
        const result: unknown = await this.db.execute(sql`
            SELECT tgname::text AS "name" FROM pg_trigger
             WHERE tgrelid = to_regclass('subscription_invoice_archive')
               AND tgenabled IN ('O', 'A')`);
        return invoiceArchiveProtectionProblem(triggerNamesOf(result));
    }
}

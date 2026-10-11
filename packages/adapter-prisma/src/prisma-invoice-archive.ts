import { Inject, Injectable } from '@nestjs/common';
import type {
    ArchivedInvoiceDocument,
    CanonicalSubscriptionInvoiceArchiveRow,
    InvoiceArchivePort,
    InvoiceDocumentToArchive,
} from '@saasicat/core';
import {
    invoiceArchiveProtectionProblem,
    subscriptionInvoiceDocumentChanged,
    toArchivedInvoiceDocument,
} from '@saasicat/core';
import { PRISMA_CLIENT_TOKEN, type PrismaModelDelegateLike } from './prisma-client-token.js';

/** Narrow view of the client: the one delegate the archive writes and reads, and the catalogue. */
interface ArchivePrisma {
    subscriptionInvoiceArchive: PrismaModelDelegateLike<CanonicalSubscriptionInvoiceArchiveRow>;
    $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * `InvoiceArchivePort` against `subscription_invoice_archive`: one file per
 * invoice, written once. The table's triggers refuse every update, delete and
 * truncate (`1.0-an-invoice-document-is-archived.postgres.sql`), so nothing here
 * changes a file once it is stored.
 */
@Injectable()
export class PrismaInvoiceArchive implements InvoiceArchivePort {
    constructor(@Inject(PRISMA_CLIENT_TOKEN) private readonly prisma: unknown) {}

    private get db(): ArchivePrisma {
        return this.prisma as ArchivePrisma;
    }

    async store(document: InvoiceDocumentToArchive): Promise<void> {
        // `ON CONFLICT DO NOTHING` on the invoice: a file stored before stays,
        // and the one handed over now is compared with it by its checksum.
        const written = await this.db.subscriptionInvoiceArchive.createManyAndReturn({
            data: [
                {
                    invoiceId: document.invoiceId,
                    checksum: document.checksum,
                    mediaType: document.mediaType,
                    fileName: document.fileName,
                    content: document.content,
                    archivedAt: document.archivedAt,
                },
            ],
            skipDuplicates: true,
            select: { invoiceId: true },
        });
        if (written.length > 0) return;
        const stored = await this.db.subscriptionInvoiceArchive.findUnique({
            where: { invoiceId: document.invoiceId },
            select: { checksum: true },
        });
        if (stored && stored.checksum !== document.checksum) {
            throw subscriptionInvoiceDocumentChanged(
                document.invoiceId,
                stored.checksum,
                document.checksum,
            );
        }
    }

    async read(invoiceId: string): Promise<ArchivedInvoiceDocument | null> {
        const row = await this.db.subscriptionInvoiceArchive.findUnique({ where: { invoiceId } });
        return row ? toArchivedInvoiceDocument(row) : null;
    }

    async protectionProblem(): Promise<string | null> {
        // Enabled is `O`, as triggers fire by default, or `A`, always; `D` is
        // disabled, and `R` fires only in a session that replicates.
        const rows = (await this.db.$queryRaw`
            SELECT tgname::text AS "name" FROM pg_trigger
             WHERE tgrelid = to_regclass('subscription_invoice_archive')
               AND tgenabled IN ('O', 'A')`) as Array<{ name: string }>;
        return invoiceArchiveProtectionProblem(rows.map((row) => row.name));
    }
}

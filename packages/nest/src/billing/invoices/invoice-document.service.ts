// An issued invoice's document: rendered, checked, archived, mailed, and
// handed out again only as it was archived.
//
// The invoice run issues an invoice first, under its number (`SC-PRIC-072`);
// this service then renders its document from what the invoice records, has
// the tax adapter check the file against the format its law requires
// (`SC-PRIC-042`), records the file's checksum with the invoice, archives the
// file and records the archive's confirmation (`SC-AUD-019`). Until then the
// invoice waits for its document — neither sent nor offered — and the next run
// tries again, never under a second number (`SC-PRIC-033`). A file the archive
// already holds is the one the invoice was issued as, and the record follows
// it; where it holds none, nothing has been handed out, so a rendering that
// differs from the recorded one — a renderer updated in between — takes its
// place, with both checksums in the audit log. An archived invoice is then
// mailed to the subscriber's
// invoice email with the file attached (`SC-PRIC-094`) — claimed first, so of
// several instances one sends it — and every later download returns the
// archived file after checking it against the recorded checksum (`SC-AUD-014`).
//
// What cannot go on yet is held rather than guessed at: a file the adapter
// refuses, a subscriber without an invoice email, an archived file that no
// longer matches its checksum. Each is logged on every run and written to the
// audit log once per process. Platform-wide, so inside `RlsBypassPort`.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    type OnModuleInit,
    Optional,
} from '@nestjs/common';
import {
    INVOICE_ERROR_CODES,
    type InvoiceArchivePort,
    type InvoiceDocument,
    type InvoiceMailPort,
    type InvoiceRenderer,
    type RlsBypassPort,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { AdminAuditService } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { codedError } from '../../errors/coded-error.js';
import { SubscriberService } from '../../subscriber/subscriber.service.js';
import { TAX_TREATMENTS_TOKEN } from '../../tax/tax.tokens.js';
import type { TaxTreatments } from '../../tax/tax-treatments.js';
import {
    ARCHIVED_FILE_DELIVERY_LEASE_MS,
    ARCHIVED_FILE_TIMEOUT_MS,
    ArchivedFileRun,
    fileChecksum,
    Held,
    type ArchivingRun,
    type MailingRun,
} from '../archived-files/archived-file-run.js';
import { addressGivenFor } from './invoice-delivery-address.js';
import {
    INVOICE_ARCHIVE_TOKEN,
    INVOICE_MAIL_PORT_TOKEN,
    INVOICE_RENDERER_TOKEN,
} from './invoice-document.tokens.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/**
 * How long the application may take to render one invoice, or to send one, before the
 * attempt counts as failed.
 */
export const INVOICE_DOCUMENT_TIMEOUT_MS = ARCHIVED_FILE_TIMEOUT_MS;

/** How long a run's claim on an invoice's mail holds. */
export const INVOICE_DELIVERY_LEASE_MS = ARCHIVED_FILE_DELIVERY_LEASE_MS;

/** What an archiving run did. */
export type InvoiceDocumentRun = ArchivingRun;

/** What a mailing run did. */
export type InvoiceDeliveryRun = MailingRun;

/** SHA-256 of a file, lower-case hex, as the invoice records it. */
export const invoiceDocumentChecksum = fileChecksum;

@Injectable()
export class InvoiceDocumentService implements OnModuleInit {
    private readonly run: ArchivedFileRun<SubscriptionInvoiceRecord>;

    constructor(
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(INVOICE_RENDERER_TOKEN)
        renderer: InvoiceRenderer,
        @Inject(INVOICE_ARCHIVE_TOKEN)
        private readonly archive: InvoiceArchivePort,
        @Inject(INVOICE_MAIL_PORT_TOKEN)
        mail: InvoiceMailPort,
        @Inject(SubscriberService)
        subscribers: SubscriberService,
        @Inject(TAX_TREATMENTS_TOKEN)
        taxes: TaxTreatments,
        // The runs are the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        audit: AdminAuditService | null = null,
    ) {
        this.run = new ArchivedFileRun({
            job: 'subscription-invoices',
            entity: 'SubscriptionInvoice',
            logger: new Logger(InvoiceDocumentService.name),
            fileOfId: (id) => `the document of invoice ${id}`,
            nameOf: (invoice) => `invoice ${invoice.number}`,
            idOf: (invoice) => invoice.id,
            auditOf: (invoice) => ({
                tenantId: invoice.tenantId,
                subscriberId: invoice.subscriberId,
                number: invoice.number,
            }),
            load: (id) => invoices.findById(id),
            render: (invoice) => renderer.render(invoice),
            // Holds an invoice whose file the tax adapter refuses (`SC-PRIC-042`).
            check: async (invoice, file) => {
                const missing = await taxes.invoiceDocumentGaps(file, invoice);
                if (missing.length === 0) return;
                throw new Held({
                    code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_REFUSED,
                    params: { adapter: invoice.taxTreatment.adapter.name, missing: [...missing] },
                });
            },
            // A cancellation invoice and its replacement go where the operator
            // said to send them, and are not written onto the subscriber's record.
            recipient: async (invoice) => {
                const subscriber = await subscribers.getById(invoice.subscriberId);
                return (await addressGivenFor(invoices, invoice)) ?? subscriber.invoiceEmail;
            },
            send: (invoice, to, document) => mail.deliver({ invoice, to, document }),
            marks: {
                find: (id) => invoices.findDocument(id),
                recordRendering: (id, rendering) => invoices.recordRendering(id, rendering),
                replaceRendering: (id, rendering, replaced) =>
                    invoices.replaceRendering(id, rendering, replaced),
                markArchived: (id, at, checksum) => invoices.markArchived(id, at, checksum),
                claimDelivery: (id, at, staleBefore) => invoices.claimDelivery(id, at, staleBefore),
                markDelivered: (id, delivery) => invoices.markDelivered(id, delivery),
                releaseDelivery: (id, claimedAt) => invoices.releaseDelivery(id, claimedAt),
                listAwaitingArchive: (page) => invoices.listAwaitingDocument(page),
                listAwaitingDelivery: (page) => invoices.listAwaitingDelivery(page),
            },
            archive: {
                store: (invoiceId, file) => archive.store({ ...file, invoiceId }),
                read: (invoiceId) => archive.read(invoiceId),
            },
            codes: {
                changed: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED,
                mismatch: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH,
                noAddress: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_INVOICE_EMAIL,
            },
            actions: {
                held: 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD',
                rerendered: 'SUBSCRIPTION_INVOICE_DOCUMENT_RERENDERED',
                mismatch: 'SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH',
                deliveryHeld: 'SUBSCRIPTION_INVOICE_DELIVERY_HELD',
                deliveryFailed: 'SUBSCRIPTION_INVOICE_DELIVERY_FAILED',
            },
            fileParams: (invoice) => ({ invoiceId: invoice.id }),
            addressParams: (invoice) => ({ subscriberId: invoice.subscriberId }),
            audit,
        });
    }

    /**
     * Refuses to start beside an archive that would let a document it keeps be
     * changed (`SC-AUD-014`): an invoice archived there would be kept as the
     * law asks only until somebody changed it, and nothing would say so.
     */
    async onModuleInit(): Promise<void> {
        const problem = await this.archive.protectionProblem();
        if (problem) throw new Error(`Invoices cannot start:\n- ${problem}`);
    }

    /** Renders, checks and archives the document of every invoice still waiting for one. */
    async archiveDue(now: Date): Promise<InvoiceDocumentRun> {
        return readAcrossTenants(this.rlsBypass, () => this.run.archiveDue(now));
    }

    /**
     * Mails every archived invoice not yet handed to the mail and held by no
     * other run. Each is claimed at the moment it is taken on, by the clock,
     * since the claim is read against those of other instances.
     */
    async deliverDue(): Promise<InvoiceDeliveryRun> {
        return readAcrossTenants(this.rlsBypass, () => this.run.deliverDue());
    }

    /**
     * The archived document of an invoice, after checking it against the
     * checksum recorded when it was rendered. Refused with
     * `SUBSCRIPTION_INVOICE_NOT_FOUND` (404) for no such invoice,
     * `SUBSCRIPTION_INVOICE_DOCUMENT_NOT_ARCHIVED` (409) while it waits for its
     * document, and `SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH` (409) for a file
     * that does not match — which is not handed out but written to the audit
     * log for the operator.
     */
    async documentOf(invoiceId: string): Promise<InvoiceDocument> {
        const found = await readAcrossTenants(this.rlsBypass, () => this.run.handOut(invoiceId));
        switch (found.kind) {
            case 'file':
                return found.file;
            case 'unknown':
                throw new NotFoundException(
                    codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND, { invoiceId }),
                );
            case 'waiting':
                throw new ConflictException(
                    codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_NOT_ARCHIVED, {
                        invoiceId,
                    }),
                );
            case 'mismatch':
                throw new ConflictException(
                    codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH, {
                        invoiceId,
                    }),
                );
        }
    }
}

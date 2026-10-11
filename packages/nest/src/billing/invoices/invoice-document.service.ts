// An issued invoice's document: rendered, checked, archived, mailed, and
// handed out again only as it was archived.
//
// The invoice run issues an invoice first, under its number (`SC-PRIC-072`);
// this service then renders its document from what the invoice records, has
// the tax adapter check the file against the format its law requires
// (`SC-PRIC-042`), records the file's checksum with the invoice, archives the
// file and records the archive's confirmation (`SC-AUD-015`). Until then the
// invoice waits for its document — neither sent nor offered — and the next run
// tries again; the repeated attempt is the same write, never a second number
// (`SC-PRIC-033`). An archived invoice is then mailed to the subscriber's
// invoice email with the file attached (`SC-PRIC-047`) — claimed first, so of
// several instances one sends it — and every later download returns the
// archived file after checking it against the recorded checksum (`SC-AUD-014`).
//
// What cannot go on yet is held rather than guessed at: a file the adapter
// refuses, a renderer that rendered other bytes than it did the first time, a
// subscriber without an invoice email, an archived file that no longer matches
// its checksum. Each is logged on every run and written to the audit log once
// per process. Platform-wide, so inside `RlsBypassPort`.

import { createHash } from 'node:crypto';
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
    isPersistenceRefusal,
    type InvoiceArchivePort,
    type InvoiceDocument,
    type InvoiceMailPort,
    type InvoiceRenderer,
    type RlsBypassPort,
    type SubscriptionInvoiceRecord,
    type SubscriptionInvoiceRepository,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../../admin/admin.tokens.js';
import { AdminAuditService, platformJobActor } from '../../admin/admin-audit.service.js';
import { readAcrossTenants } from '../../admin/read-across-tenants.js';
import { TimeoutError, withTimeout } from '../../core/with-timeout.js';
import { codedError } from '../../errors/coded-error.js';
import { SubscriberService } from '../../subscriber/subscriber.service.js';
import { TAX_TREATMENTS_TOKEN } from '../../tax/tax.tokens.js';
import type { TaxTreatments } from '../../tax/tax-treatments.js';
import { AuditedOnce } from './audited-once.js';
import {
    INVOICE_ARCHIVE_TOKEN,
    INVOICE_MAIL_PORT_TOKEN,
    INVOICE_RENDERER_TOKEN,
} from './invoice-document.tokens.js';
import { SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN } from './subscription-invoice.tokens.js';

/** The name the run writes its audit entries under: `job:platform:subscription-invoices`. */
const JOB = 'subscription-invoices';

/** How many invoices one page of a run reads. */
const PAGE_SIZE = 100;

/**
 * How long the application may take to render one invoice, or to send one, before the
 * attempt counts as failed. Both are the application's code, and a run waiting on
 * either for good would issue no invoice after it.
 */
export const INVOICE_DOCUMENT_TIMEOUT_MS = 60_000;

/**
 * How long a run's claim on an invoice's mail holds. Longer than an attempt may
 * take, so a second instance does not send the invoice while the first still
 * waits for the application to answer.
 */
export const INVOICE_DELIVERY_LEASE_MS = 15 * 60_000;

/**
 * What holds an invoice's document or its mail back: the coded refusal where
 * there is one, which the administration words in the operator's language.
 */
interface DocumentHold {
    code?: string;
    params: Record<string, unknown>;
}

/** Thrown inside one invoice's step to hold it; never leaves the service. */
class Held extends Error {
    constructor(readonly hold: DocumentHold) {
        super(hold.code);
    }
}

/** What an archiving run did. */
export interface InvoiceDocumentRun {
    archived: number;
    /** Invoices whose document is held back; each is tried again by the next run. */
    held: number;
    /** Invoices whose document failed for another reason; each is tried again by the next run. */
    failed: number;
}

/** What a mailing run did. */
export interface InvoiceDeliveryRun {
    delivered: number;
    /** Invoices that cannot be mailed yet, such as to a subscriber without an invoice email. */
    held: number;
    /** Invoices the mail port did not take; each is tried again by the next run. */
    failed: number;
}

/** SHA-256 of a file, lower-case hex, as the invoice records it. */
export function invoiceDocumentChecksum(content: Uint8Array): string {
    return createHash('sha256').update(content).digest('hex');
}

@Injectable()
export class InvoiceDocumentService implements OnModuleInit {
    private readonly logger = new Logger(InvoiceDocumentService.name);
    private readonly audited = new AuditedOnce();
    private readonly timeoutMs = INVOICE_DOCUMENT_TIMEOUT_MS;

    constructor(
        @Inject(SUBSCRIPTION_INVOICE_REPOSITORY_TOKEN)
        private readonly invoices: SubscriptionInvoiceRepository,
        @Inject(INVOICE_RENDERER_TOKEN)
        private readonly renderer: InvoiceRenderer,
        @Inject(INVOICE_ARCHIVE_TOKEN)
        private readonly archive: InvoiceArchivePort,
        @Inject(INVOICE_MAIL_PORT_TOKEN)
        private readonly mail: InvoiceMailPort,
        @Inject(SubscriberService)
        private readonly subscribers: SubscriberService,
        @Inject(TAX_TREATMENTS_TOKEN)
        private readonly taxes: TaxTreatments,
        // The runs are the installation's, not a tenant's.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

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
        return readAcrossTenants(this.rlsBypass, async () => {
            const run: InvoiceDocumentRun = { archived: 0, held: 0, failed: 0 };
            await this.eachPage(
                (page) => this.invoices.listAwaitingDocument(page),
                async (invoiceId) => {
                    const outcome = await this.archiveOne(invoiceId, now).catch((error: unknown) =>
                        this.failed(invoiceId, error),
                    );
                    run[outcome] += 1;
                },
            );
            return run;
        });
    }

    /**
     * Mails every archived invoice not yet handed to the mail and held by no
     * other run. Each is claimed at the moment it is taken on, by the clock,
     * since the claim is read against those of other instances.
     */
    async deliverDue(): Promise<InvoiceDeliveryRun> {
        return readAcrossTenants(this.rlsBypass, async () => {
            const run: InvoiceDeliveryRun = { delivered: 0, held: 0, failed: 0 };
            await this.eachPage(
                (page) => this.invoices.listAwaitingDelivery(page),
                async (invoiceId) => {
                    const outcome = await this.deliverOne(invoiceId).catch((error: unknown) =>
                        this.failed(invoiceId, error),
                    );
                    if (outcome) run[outcome] += 1;
                },
            );
            return run;
        });
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
        return readAcrossTenants(this.rlsBypass, async () => {
            const invoice = await this.invoices.findById(invoiceId);
            if (!invoice) {
                throw new NotFoundException(
                    codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NOT_FOUND, { invoiceId }),
                );
            }
            const state = await this.invoices.findDocument(invoiceId);
            if (!state?.archivedAt) {
                throw new ConflictException(
                    codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_NOT_ARCHIVED, {
                        invoiceId,
                    }),
                );
            }
            const document = await this.matching(invoiceId, state.checksum);
            if (!document) {
                await this.recordHold(invoice, 'SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH', {
                    code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH,
                    params: { invoiceId },
                });
                throw new ConflictException(
                    codedError(INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH, {
                        invoiceId,
                    }),
                );
            }
            return document;
        });
    }

    private async archiveOne(invoiceId: string, now: Date): Promise<keyof InvoiceDocumentRun> {
        const invoice = await this.invoices.findById(invoiceId);
        if (!invoice) return this.failed(invoiceId, new Error('the invoice was not found'));
        try {
            // An attempt interrupted after the archive took the file: the file
            // kept is the recorded one, so it is confirmed rather than rendered
            // again by a renderer that may have changed since.
            const recorded = await this.invoices.findDocument(invoiceId);
            if (recorded && (await this.matching(invoiceId, recorded.checksum))) {
                await this.invoices.markArchived(invoiceId, now);
                return 'archived';
            }
            const document = await withTimeout(() => this.renderer.render(invoice), this.timeoutMs);
            const missing = await this.taxes.invoiceDocumentGaps(document, invoice);
            if (missing.length > 0) {
                throw new Held({
                    code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_REFUSED,
                    params: { adapter: invoice.taxTreatment.adapter.name, missing: [...missing] },
                });
            }
            const checksum = invoiceDocumentChecksum(document.content);
            await refusalHeld(() =>
                this.invoices.recordRendering(invoiceId, {
                    checksum,
                    mediaType: document.mediaType,
                    fileName: document.fileName,
                    size: document.content.byteLength,
                    renderedAt: now,
                }),
            );
            await refusalHeld(() =>
                this.archive.store({ ...document, invoiceId, checksum, archivedAt: now }),
            );
            await this.invoices.markArchived(invoiceId, now);
            return 'archived';
        } catch (error) {
            if (!(error instanceof Held)) return this.failed(invoiceId, error);
            await this.recordHold(invoice, 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD', error.hold);
            return 'held';
        }
    }

    /** What mailing one invoice came to; `null` where another run holds it. */
    private async deliverOne(invoiceId: string): Promise<keyof InvoiceDeliveryRun | null> {
        const invoice = await this.invoices.findById(invoiceId);
        const state = invoice && (await this.invoices.findDocument(invoiceId));
        if (!invoice || !state) {
            return this.failed(invoiceId, new Error('the invoice or its document was not found'));
        }
        const subscriber = await this.subscribers.getById(invoice.subscriberId);
        const to = subscriber.invoiceEmail;
        if (!to) {
            await this.recordHold(invoice, 'SUBSCRIPTION_INVOICE_DELIVERY_HELD', {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_NO_INVOICE_EMAIL,
                params: { subscriberId: invoice.subscriberId },
            });
            return 'held';
        }
        const document = await this.matching(invoiceId, state.checksum);
        if (!document) {
            await this.recordHold(invoice, 'SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH', {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH,
                params: { invoiceId },
            });
            return 'held';
        }
        // Stamped with the moment it is taken, not with the start of the run: a
        // run that takes longer than the lease would otherwise take claims that
        // every other instance already reads as abandoned.
        const claimedAt = new Date();
        const staleBefore = new Date(claimedAt.getTime() - INVOICE_DELIVERY_LEASE_MS);
        if (!(await this.invoices.claimDelivery(invoiceId, claimedAt, staleBefore))) return null;

        // A port that throws before it returns a promise fails like one that
        // rejects, rather than escaping the run with its claim still held.
        const sending = new Promise<void>((resolve) =>
            resolve(this.mail.deliver({ invoice, to, document })),
        );
        try {
            await withTimeout(() => sending, this.timeoutMs);
        } catch (error) {
            if (error instanceof TimeoutError) {
                this.settleLate(sending, invoice, claimedAt, to);
            } else {
                await this.deliveryFailed(invoice, claimedAt, to, error);
            }
            return 'failed';
        }
        await this.recordDelivered(invoice, claimedAt, to);
        return 'delivered';
    }

    /**
     * A mail that has not answered in time may still go out, so its claim is
     * not let go: no other run sends the invoice while the answer is awaited. A
     * late success is recorded, a late failure lets the claim go for the next
     * run. An answer later than the lease comes after another run may have sent
     * the invoice again.
     */
    private settleLate(
        sending: Promise<void>,
        invoice: SubscriptionInvoiceRecord,
        claimedAt: Date,
        to: string,
    ): void {
        this.logger.warn(
            `The mail did not answer within ${this.timeoutMs} ms for invoice ` +
                `${invoice.number}; it stays held while the answer is awaited.`,
        );
        void sending.then(
            () => this.recordDelivered(invoice, claimedAt, to),
            (error: unknown) => this.deliveryFailed(invoice, claimedAt, to, error),
        );
    }

    /**
     * Shows the operator a mail that was not sent, and lets the claim go for
     * the next run. The address stays on the subscriber's record, and is taken
     * out of the reason the mail gave, which a mail server often words with
     * the recipient in it. A claim that cannot be let go is not lost — it goes
     * stale and is taken on then — so that failure is logged, not thrown.
     */
    private async deliveryFailed(
        invoice: SubscriptionInvoiceRecord,
        claimedAt: Date,
        to: string,
        error: unknown,
    ): Promise<void> {
        this.logger.error(
            `Invoice ${invoice.number} was not mailed; the next run tries again.`,
            error instanceof Error ? error.stack : String(error),
        );
        await this.recordHold(invoice, 'SUBSCRIPTION_INVOICE_DELIVERY_FAILED', {
            params: { reason: withoutAddress(errorMessageOf(error), to) },
        });
        try {
            await this.invoices.releaseDelivery(invoice.id, claimedAt);
        } catch (releaseError) {
            this.logger.error(
                `The mail of invoice ${invoice.number} could not be let go; it is tried again ` +
                    'once its claim goes stale.',
                releaseError instanceof Error ? releaseError.stack : String(releaseError),
            );
        }
    }

    /**
     * Records an invoice the mail has taken. It went out whatever happens
     * here, so a failure to record it is not let go for another attempt: it is
     * logged, and the run goes on to the next invoice.
     */
    private async recordDelivered(
        invoice: SubscriptionInvoiceRecord,
        claimedAt: Date,
        to: string,
    ): Promise<void> {
        try {
            const recorded = await this.invoices.markDelivered(invoice.id, {
                claimedAt,
                at: new Date(),
                to,
            });
            if (!recorded) {
                this.logger.warn(
                    `Invoice ${invoice.number} was mailed, but its claim had gone stale and ` +
                        'another run took it on; the subscriber may receive it twice.',
                );
            }
        } catch (error) {
            this.logger.error(
                `Invoice ${invoice.number} was mailed, but recording it failed; once its claim ` +
                    'goes stale the subscriber may receive it again.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }

    /** The archived file of `invoiceId` where it matches `checksum`; `null` where it is missing or does not. */
    private async matching(invoiceId: string, checksum: string): Promise<InvoiceDocument | null> {
        const archived = await this.archive.read(invoiceId);
        if (!archived) return null;
        if (archived.checksum !== checksum) return null;
        if (invoiceDocumentChecksum(archived.content) !== checksum) return null;
        return {
            content: archived.content,
            mediaType: archived.mediaType,
            fileName: archived.fileName,
        };
    }

    private async eachPage(
        list: (page: { limit: number; after?: string }) => Promise<string[]>,
        each: (invoiceId: string) => Promise<void>,
    ): Promise<void> {
        let after: string | undefined;
        for (;;) {
            const page = await list({ limit: PAGE_SIZE, after });
            for (const invoiceId of page) await each(invoiceId);
            if (page.length < PAGE_SIZE) return;
            after = page.at(-1);
        }
    }

    private failed(invoiceId: string, error: unknown): 'failed' {
        this.logger.error(
            `The document of invoice ${invoiceId} could not be handled; the next run tries again.`,
            error instanceof Error ? error.stack : String(error),
        );
        return 'failed';
    }

    private async recordHold(
        invoice: SubscriptionInvoiceRecord,
        action: string,
        hold: DocumentHold,
    ): Promise<void> {
        this.logger.warn(
            `Invoice ${invoice.number}: ${action} ${hold.code ?? ''} ${JSON.stringify(hold.params)}. ` +
                'The next run tries again.',
        );
        await this.audited.record(`${invoice.id}|${action}|${hold.code ?? ''}`, async () => {
            try {
                await this.audit?.log({
                    actor: platformJobActor(JOB),
                    entity: 'SubscriptionInvoice',
                    entityId: invoice.id,
                    action,
                    changes: {
                        tenantId: invoice.tenantId,
                        subscriberId: invoice.subscriberId,
                        number: invoice.number,
                        ...(hold.code ? { code: hold.code } : {}),
                        params: hold.params,
                    },
                });
                return true;
            } catch (error) {
                // The hold stands either way; the lost record of it is said loudly.
                this.logger.error(
                    `Writing the audit entry ${action} for invoice ${invoice.number} failed.`,
                    error instanceof Error ? error.stack : String(error),
                );
                return false;
            }
        });
    }
}

function errorMessageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** `message` with every occurrence of `address` in it, whatever its case, replaced. */
function withoutAddress(message: string, address: string): string {
    const lower = message.toLowerCase();
    const sought = address.toLowerCase();
    if (sought === '') return message;
    let kept = '';
    let from = 0;
    for (let at = lower.indexOf(sought); at >= 0; at = lower.indexOf(sought, from)) {
        kept += `${message.slice(from, at)}[invoice email]`;
        from = at + sought.length;
    }
    return kept + message.slice(from);
}

/** Runs `write`, turning the refusal of a file other than the recorded one into a hold. */
async function refusalHeld<T>(write: () => Promise<T>): Promise<T> {
    try {
        return await write();
    } catch (error) {
        if (
            isPersistenceRefusal(error) &&
            error.code === INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_DOCUMENT_CHANGED
        ) {
            throw new Held({ code: error.code, params: { ...(error.params ?? {}) } });
        }
        throw error;
    }
}

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MaintenanceService } from '../../maintenance/maintenance.service.js';
import { ContractConfirmationService } from '../confirmations/contract-confirmation.service.js';
import { InvoiceCollectionService } from './invoice-collection.service.js';
import { InvoicePaymentService } from './invoice-payment.service.js';
import { InvoiceDocumentService } from './invoice-document.service.js';
import { SubscriptionInvoiceService } from './subscription-invoice.service.js';

/**
 * Issues the invoices the charge journal is owed, every quarter of an hour,
 * then archives their documents, mails them, confirms the contracts written
 * since the last run, and collects the invoices mailed, so a charge is
 * invoiced, sent and collected within one of being written, a contract is
 * confirmed within one of being concluded, and whatever was held back goes on
 * within one of being put right.
 *
 * Needs `ScheduleModule` in the application. Left out with
 * `tenantBilling.chargeJournal.invoices.includeCron: false` — for a CLI boot,
 * or an application that calls `SubscriptionInvoiceService.issueDue`, then
 * `InvoiceDocumentService.archiveDue` and `deliverDue`, then
 * `ContractConfirmationService.archiveDue` and `deliverDue`, then
 * `InvoiceCollectionService.collectDue`, from a scheduler of its own. An
 * invoice is mailed only once its document is archived, and collected only
 * once it is mailed, and a confirmation is mailed only once it is archived, so
 * a scheduler that leaves out a step stops everything after it.
 */
@Injectable()
export class SubscriptionInvoiceCron {
    private readonly logger = new Logger(SubscriptionInvoiceCron.name);
    private running = false;

    constructor(
        private readonly invoices: SubscriptionInvoiceService,
        // Optional: without it maintenance is not on, and nothing pauses.
        @Optional()
        @Inject(MaintenanceService)
        private readonly maintenance: MaintenanceService | null = null,
        // Present wherever invoices start: the start refuses them without a
        // renderer, an archive and a mail port.
        @Optional()
        @Inject(InvoiceDocumentService)
        private readonly documents: InvoiceDocumentService | null = null,
        // Present where invoices are collected through a gateway.
        @Optional()
        @Inject(InvoiceCollectionService)
        private readonly collections: InvoiceCollectionService | null = null,
        // Beside the collections: what they brought, and the credits.
        @Optional()
        @Inject(InvoicePaymentService)
        private readonly payments: InvoicePaymentService | null = null,
        // Present wherever invoices start: the start refuses them without the
        // confirmations' renderer, record and archive.
        @Optional()
        @Inject(ContractConfirmationService)
        private readonly confirmations: ContractConfirmationService | null = null,
    ) {}

    @Cron('*/15 * * * *', { name: 'subscriptionInvoices' })
    async issueDueInvoices(): Promise<void> {
        // A run skipped under a maintenance lock is caught up by the next one:
        // what is owed then includes what was owed now.
        if (await this.maintenance?.isLocked()) {
            this.logger.log('Invoices: skipped, the application is locked for maintenance.');
            return;
        }
        // A run still issuing when the next is due lets it pass; the one after
        // finds what is left.
        if (this.running) return;
        this.running = true;
        try {
            // Each step reads the clock as it starts, and each holds up none of
            // the others: an invoice issued now is archived by the step after,
            // one archived then is mailed by the next, and one mailed then is
            // collected by the last. The confirmations go between, on their
            // own: a contract is confirmed whether or not it was invoiced yet.
            const issued = await this.step('Invoices', () => this.invoices.issueDue(new Date()));
            if (issued && (issued.issued > 0 || issued.held > 0 || issued.failed > 0)) {
                this.logger.log(
                    `Invoices: ${issued.issued} issued, ${issued.held} held back, ` +
                        `${issued.failed} to try again.`,
                );
            }
            // An invoice whose total is negative is a credit from the run that
            // issued it (`SC-PRIC-083`).
            const credited = await this.step('Invoice credits', () => this.payments?.creditDue());
            if (credited) this.logger.log(`Invoice credits: ${credited} recorded.`);
            const archived = await this.step('Invoice documents', () =>
                this.documents?.archiveDue(new Date()),
            );
            if (archived && (archived.archived > 0 || archived.held > 0 || archived.failed > 0)) {
                this.logger.log(
                    `Invoice documents: ${archived.archived} archived, ${archived.held} held back, ` +
                        `${archived.failed} to try again.`,
                );
            }
            const delivered = await this.step('Invoice mail', () => this.documents?.deliverDue());
            if (
                delivered &&
                (delivered.delivered > 0 || delivered.held > 0 || delivered.failed > 0)
            ) {
                this.logger.log(
                    `Invoice mail: ${delivered.delivered} sent, ${delivered.held} held back, ` +
                        `${delivered.failed} to try again.`,
                );
            }
            const confirmed = await this.step('Contract confirmations', () =>
                this.confirmations?.archiveDue(new Date()),
            );
            if (
                confirmed &&
                (confirmed.archived > 0 || confirmed.held > 0 || confirmed.failed > 0)
            ) {
                this.logger.log(
                    `Contract confirmations: ${confirmed.archived} archived, ${confirmed.held} ` +
                        `held back, ${confirmed.failed} to try again.`,
                );
            }
            const confirmationsSent = await this.step('Contract confirmation mail', () =>
                this.confirmations?.deliverDue(),
            );
            if (
                confirmationsSent &&
                (confirmationsSent.delivered > 0 ||
                    confirmationsSent.held > 0 ||
                    confirmationsSent.failed > 0)
            ) {
                this.logger.log(
                    `Contract confirmation mail: ${confirmationsSent.delivered} sent, ` +
                        `${confirmationsSent.held} held back, ${confirmationsSent.failed} to try again.`,
                );
            }
            const collected = await this.step('Invoice collection', () =>
                this.collections?.collectDue(new Date()),
            );
            if (collected && Object.values(collected).some((count) => count > 0)) {
                this.logger.log(
                    `Invoice collection: ${collected.collected} collected, ${collected.pending} on ` +
                        `their way, ${collected.failed} failed, ${collected.waiting} waiting for a ` +
                        `new announcement, ${collected.unanswered} to ask again.`,
                );
            }
        } finally {
            this.running = false;
        }
    }

    /**
     * One step of the run. A step that fails is logged and holds up none of
     * the others; the next run tries the failed one again.
     */
    private async step<T>(name: string, run: () => Promise<T> | undefined): Promise<T | undefined> {
        try {
            return await run();
        } catch (error) {
            this.logger.error(
                `${name}: the run failed; the next one tries again.`,
                error instanceof Error ? error.stack : String(error),
            );
            return undefined;
        }
    }
}

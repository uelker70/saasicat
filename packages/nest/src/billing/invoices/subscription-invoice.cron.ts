import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MaintenanceService } from '../../maintenance/maintenance.service.js';
import { InvoiceDocumentService } from './invoice-document.service.js';
import { SubscriptionInvoiceService } from './subscription-invoice.service.js';

/**
 * Issues the invoices the charge journal is owed, every quarter of an hour,
 * then archives their documents and mails them, so a charge is invoiced and
 * sent within one of being written, and whatever was held back goes on within
 * one of being put right.
 *
 * Needs `ScheduleModule` in the application. Left out with
 * `tenantBilling.chargeJournal.invoices.includeCron: false` — for a CLI boot,
 * or an application that calls `SubscriptionInvoiceService.issueDue`, then
 * `InvoiceDocumentService.archiveDue` and `deliverDue`, from a scheduler of its
 * own. An invoice is mailed only once its document is archived, so a scheduler
 * that leaves out `archiveDue` sends nothing.
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
            // and one archived then is mailed by the last.
            const issued = await this.step('Invoices', () => this.invoices.issueDue(new Date()));
            if (issued && (issued.issued > 0 || issued.held > 0 || issued.failed > 0)) {
                this.logger.log(
                    `Invoices: ${issued.issued} issued, ${issued.held} held back, ` +
                        `${issued.failed} to try again.`,
                );
            }
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

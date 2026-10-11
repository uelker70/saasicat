import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MaintenanceService } from '../../maintenance/maintenance.service.js';
import { SubscriptionInvoiceService } from './subscription-invoice.service.js';

/**
 * Issues the invoices the charge journal is owed, every quarter of an hour, so
 * a charge is invoiced within one of being written and an invoice held back is
 * issued within one of what held it being put right.
 *
 * Needs `ScheduleModule` in the application. Left out with
 * `tenantBilling.chargeJournal.invoices.includeCron: false` — for a CLI boot,
 * or an application that calls `SubscriptionInvoiceService.issueDue` from a
 * scheduler of its own.
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
            const run = await this.invoices.issueDue(new Date());
            if (run.issued > 0 || run.held > 0 || run.failed > 0) {
                this.logger.log(
                    `Invoices: ${run.issued} issued, ${run.held} held back, ` +
                        `${run.failed} to try again.`,
                );
            }
        } catch (error) {
            this.logger.error(
                'Invoices: the run failed; the next one tries again.',
                error instanceof Error ? error.stack : String(error),
            );
        } finally {
            this.running = false;
        }
    }
}

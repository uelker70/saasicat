import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { DeletionReminderService } from './deletion-reminder.service.js';
import { runStep } from './run-step.js';
import { SubscriptionEndService } from './subscription-end.service.js';

/**
 * Records the subscriptions that ended, every quarter of an hour, so a tenant
 * is held to reading within one of its cancellation landing and its deletion
 * day is fixed then (`SC-CANC-027`) — and then reminds the administrators of
 * each tenant whose deletion day is near (`SC-CANC-022`), an end recorded in
 * the same run included.
 *
 * Needs `ScheduleModule` in the application. Left out with
 * `tenantBilling.subscriptionEnds.includeCron: false` — for a CLI boot, or an
 * application that calls `SubscriptionEndService.recordEnded` and then
 * `DeletionReminderService.remindDue` from a scheduler of its own.
 */
@Injectable()
export class SubscriptionEndCron {
    private readonly logger = new Logger(SubscriptionEndCron.name);
    private running = false;

    constructor(
        private readonly ends: SubscriptionEndService,
        private readonly reminders: DeletionReminderService,
        // Optional: without it maintenance is not on, and nothing pauses.
        @Optional()
        @Inject(MaintenanceService)
        private readonly maintenance: MaintenanceService | null = null,
    ) {}

    @Cron('*/15 * * * *', { name: 'subscriptionEnds' })
    async recordAndRemind(): Promise<void> {
        // A run skipped under a maintenance lock is caught up by the next one:
        // a subscription that ended meanwhile is still found, its deletion day
        // counts from the day it ended, and a lead time that passed meanwhile
        // is reminded of then.
        if (await this.maintenance?.isLocked()) {
            this.logger.log(
                'Subscription ends: skipped, the application is locked for maintenance.',
            );
            return;
        }
        // A run still going when the next is due lets it pass; the one after
        // finds what is left.
        if (this.running) return;
        this.running = true;
        try {
            const recorded = await runStep(this.logger, 'Subscription ends', () =>
                this.ends.recordEnded(new Date()),
            );
            if (recorded && recorded.ended > 0) {
                this.logger.log(`Subscription ends: ${recorded.ended} recorded.`);
            }
            // After the ends, whether or not recording them succeeded: the ends
            // recorded before keep their days and are reminded all the same.
            const reminded = await runStep(this.logger, 'Deletion reminders', () =>
                this.reminders.remindDue(new Date()),
            );
            if (reminded && (reminded.told > 0 || reminded.failed > 0)) {
                this.logger.log(
                    `Deletion reminders: ${reminded.told} sent, ${reminded.failed} to try again.`,
                );
            }
        } finally {
            this.running = false;
        }
    }
}

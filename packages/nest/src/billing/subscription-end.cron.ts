import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { SubscriptionEndService } from './subscription-end.service.js';

/**
 * Records the subscriptions that ended, every quarter of an hour, so a tenant
 * is held to reading within one of its cancellation landing and its deletion
 * day is fixed then (`SC-CANC-027`).
 *
 * Needs `ScheduleModule` in the application. Left out with
 * `tenantBilling.subscriptionEnds.includeCron: false` — for a CLI boot, or an
 * application that calls `SubscriptionEndService.recordEnded` from a scheduler
 * of its own.
 */
@Injectable()
export class SubscriptionEndCron {
    private readonly logger = new Logger(SubscriptionEndCron.name);
    private running = false;

    constructor(
        private readonly ends: SubscriptionEndService,
        // Optional: without it maintenance is not on, and nothing pauses.
        @Optional()
        @Inject(MaintenanceService)
        private readonly maintenance: MaintenanceService | null = null,
    ) {}

    @Cron('*/15 * * * *', { name: 'subscriptionEnds' })
    async recordEnded(): Promise<void> {
        // A run skipped under a maintenance lock is caught up by the next one:
        // a subscription that ended meanwhile is still found, and its deletion
        // day counts from the day it ended.
        if (await this.maintenance?.isLocked()) {
            this.logger.log(
                'Subscription ends: skipped, the application is locked for maintenance.',
            );
            return;
        }
        // A run still recording when the next is due lets it pass; the one
        // after finds what is left.
        if (this.running) return;
        this.running = true;
        try {
            const run = await this.ends.recordEnded(new Date());
            if (run.ended > 0) this.logger.log(`Subscription ends: ${run.ended} recorded.`);
        } catch (err) {
            this.logger.error(
                'Subscription ends: the run failed; the next run tries again.',
                err instanceof Error ? err.stack : String(err),
            );
        } finally {
            this.running = false;
        }
    }
}

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { PendingRegistrationService } from './pending-registration.service.js';

/**
 * Daily cleanup cron for expired `PendingRegistration` records.
 *
 * Runs at 04:15 Europe/Berlin (aligned with `trial-expiration.cron` and
 * `PromoCodeExpirer`). Deletes in batches of 500 — the cron
 * keeps running until `moreAvailable` is false (protection against memory
 * spikes on large backlogs).
 *
 * Can be disabled via `RegistrationModule.forRoot({ includeCleanupCron: false })`
 * — e.g. for CLI boots or test setups without `ScheduleModule`.
 */
@Injectable()
export class RegistrationCleanupCron {
    private readonly logger = new Logger(RegistrationCleanupCron.name);

    constructor(
        private readonly service: PendingRegistrationService,
        // Optional: without it maintenance is not on, and nothing pauses.
        @Optional()
        @Inject(MaintenanceService)
        private readonly maintenance: MaintenanceService | null = null,
    ) {}

    @Cron('15 4 * * *', { timeZone: 'Europe/Berlin' })
    async runDaily(): Promise<void> {
        // Skipped under a maintenance lock; the next run deletes what is
        // expired by then, which includes what was expired now.
        if (await this.maintenance?.isLocked()) {
            this.logger.log(
                'Pending registration cleanup skipped: the application is locked for maintenance.',
            );
            return;
        }
        await this.runCleanup();
    }

    /**
     * Public API: can be triggered manually from an admin endpoint /
     * `/admin/registration/run-cleanup` (same pattern as
     * `PromoCodeExpirer.run` in the consuming apps).
     */
    async runCleanup(now: Date = new Date(), batchSize = 500): Promise<void> {
        let totalDeleted = 0;
        let iterations = 0;
        const MAX_ITERATIONS = 50; // 25k records per run — hard upper bound.

        while (iterations < MAX_ITERATIONS) {
            const result = await this.service.runCleanup(now, batchSize);
            totalDeleted += result.deleted;
            iterations++;
            if (!result.moreAvailable) {
                break;
            }
        }

        if (totalDeleted > 0) {
            this.logger.log(
                `Pending registration cleanup finished: ${totalDeleted} deleted in ${iterations} batches.`,
            );
        }
    }
}

/** Re-export so consumers can reuse the cron trigger in the admin module. */
export { CronExpression };

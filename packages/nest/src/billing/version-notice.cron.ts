import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { VersionNoticeService } from './version-notice.service.js';
import { VersionRetirementService } from './version-retirement.service.js';

/**
 * Sends the version notices that are due, every quarter of an hour, so an
 * offer that appears is told within one — and the retirement notices an
 * announcement could not send at once.
 *
 * Needs `ScheduleModule` in the application. Left out with
 * `tenantBilling.versionNotices.includeCron: false` — for a CLI boot, or an
 * application that calls `VersionNoticeService.sendDue` from a scheduler of its
 * own.
 */
@Injectable()
export class VersionNoticeCron {
    private readonly logger = new Logger(VersionNoticeCron.name);
    private running = false;

    constructor(
        private readonly notices: VersionNoticeService,
        // Optional: without it maintenance is not on, and nothing pauses.
        @Optional()
        @Inject(MaintenanceService)
        private readonly maintenance: MaintenanceService | null = null,
        // Optional: present where an operator may retire versions.
        @Optional()
        @Inject(VersionRetirementService)
        private readonly retirements: VersionRetirementService | null = null,
    ) {}

    @Cron('*/15 * * * *', { name: 'versionNotices' })
    async sendDueNotices(): Promise<void> {
        // A run skipped under a maintenance lock is caught up by the next one:
        // what is due then includes what was due now.
        if (await this.maintenance?.isLocked()) {
            this.logger.log('Version notices: skipped, the application is locked for maintenance.');
            return;
        }
        // A run still sending when the next is due lets it pass; the one after
        // finds what is left.
        if (this.running) return;
        this.running = true;
        try {
            const now = new Date();
            const { told, failed } = await this.notices.sendDue(now);
            if (told > 0 || failed > 0) {
                this.logger.log(`Version notices: ${told} sent, ${failed} to try again.`);
            }
            const retired = await this.retirements?.sendUndelivered(now);
            if (retired && (retired.told > 0 || retired.failed > 0)) {
                this.logger.log(
                    `Retirement notices: ${retired.told} sent, ${retired.failed} to try again.`,
                );
            }
        } finally {
            this.running = false;
        }
    }
}

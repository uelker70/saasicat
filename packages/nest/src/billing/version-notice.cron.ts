import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MaintenanceService } from '../maintenance/maintenance.service.js';
import { RetirementMoveService } from './retirement-move.service.js';
import { RetirementReminderService } from './retirement-reminder.service.js';
import { VersionNoticeService } from './version-notice.service.js';
import { VersionRetirementService } from './version-retirement.service.js';

/**
 * Sends the version notices that are due, every quarter of an hour, so an
 * offer that appears is told within one — the retirement notices an
 * announcement could not send at once, and the reminders whose day has come
 * (`SC-SUB-034`) — and moves the subscriptions whose retirement has taken
 * effect (`SC-SUB-031`).
 *
 * Needs `ScheduleModule` in the application. Left out with
 * `tenantBilling.versionNotices.includeCron: false` — for a CLI boot, or an
 * application that calls `VersionNoticeService.sendDue`,
 * `RetirementReminderService.remindDue` and `RetirementMoveService.moveDue`
 * from a scheduler of its own.
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
        // Present where retiring is: the moves at the date.
        @Optional()
        @Inject(RetirementMoveService)
        private readonly moves: RetirementMoveService | null = null,
        // Present where retiring is: the reminders before it.
        @Optional()
        @Inject(RetirementReminderService)
        private readonly reminders: RetirementReminderService | null = null,
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
            const sent = await this.step('Version notices', () => this.notices.sendDue(now));
            if (sent && (sent.told > 0 || sent.failed > 0)) {
                this.logger.log(`Version notices: ${sent.told} sent, ${sent.failed} to try again.`);
            }
            const retired = await this.step('Retirement notices', () =>
                this.retirements?.sendUndelivered(now),
            );
            if (retired && (retired.told > 0 || retired.failed > 0)) {
                this.logger.log(
                    `Retirement notices: ${retired.told} sent, ${retired.failed} to try again.`,
                );
            }
            const reminded = await this.step('Retirement reminders', () =>
                this.reminders?.remindDue(now),
            );
            if (reminded && (reminded.told > 0 || reminded.failed > 0)) {
                this.logger.log(
                    `Retirement reminders: ${reminded.told} sent, ${reminded.failed} to try again.`,
                );
            }
            const moves = await this.step('Retirement moves', () => this.moves?.moveDue(now));
            if (moves && (moves.moved > 0 || moves.failed > 0)) {
                this.logger.log(
                    `Retirement moves: ${moves.moved} moved, ${moves.failed} to try again.`,
                );
            }
        } finally {
            this.running = false;
        }
    }

    /**
     * One step of the run. A step that fails is logged and holds up none of the
     * others: they do not depend on one another, and the next run tries the
     * failed one again.
     */
    private async step<T>(name: string, run: () => Promise<T> | undefined): Promise<T | undefined> {
        try {
            return await run();
        } catch (error) {
            this.logger.error(
                `${name}: the step failed; the next run tries again.`,
                error instanceof Error ? error.stack : String(error),
            );
            return undefined;
        }
    }
}

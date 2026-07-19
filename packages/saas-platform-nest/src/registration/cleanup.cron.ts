import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PendingRegistrationService } from './pending-registration.service.js';

/**
 * Taeglicher Cleanup-Cron fuer abgelaufene `PendingRegistration`-Datensaetze.
 *
 * Laeuft 04:15 Europe/Berlin (passend zu `trial-expiration.cron` und
 * `PromoCodeExpirer` in vereinsfux). Loescht in Batches von 500 — der Cron
 * laeuft so lange, bis `moreAvailable` false ist (Schutz vor Memory-Spike
 * bei grossen Backlogs).
 *
 * Kann via `RegistrationModule.forRoot({ includeCleanupCron: false })`
 * deaktiviert werden — z. B. fuer CLI-Boots oder Test-Setups ohne
 * `ScheduleModule`.
 */
@Injectable()
export class RegistrationCleanupCron {
    private readonly logger = new Logger(RegistrationCleanupCron.name);

    constructor(private readonly service: PendingRegistrationService) {}

    @Cron('15 4 * * *', { timeZone: 'Europe/Berlin' })
    async runDaily(): Promise<void> {
        await this.runCleanup();
    }

    /**
     * Public-API: laesst sich manuell aus einem Admin-Endpoint /
     * `/admin/registration/run-cleanup` triggern (gleicher Pattern wie
     * `PromoCodeExpirer.run` in autohauspro/vereinsfux).
     */
    async runCleanup(now: Date = new Date(), batchSize = 500): Promise<void> {
        let totalDeleted = 0;
        let iterations = 0;
        const MAX_ITERATIONS = 50; // 25k Datensaetze pro Lauf — harte Obergrenze.

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
                `PendingRegistration-Cleanup abgeschlossen: ${totalDeleted} geloescht in ${iterations} Batches.`,
            );
        }
    }
}

/** Re-export, damit Konsumenten den Cron-Trigger im Admin-Modul wiederverwenden koennen. */
export { CronExpression };

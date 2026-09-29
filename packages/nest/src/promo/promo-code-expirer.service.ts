import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
    PromoCodeHoldRepository,
    PromoCodeRedemptionRepository,
    PromoCodeRepository,
    RlsBypassPort,
} from '@saasicat/core';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { MaintenanceService } from '../maintenance/maintenance.service.js';
import {
    PROMO_CODE_HOLD_REPOSITORY_TOKEN,
    PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN,
    PROMO_CODE_REPOSITORY_TOKEN,
} from './promo.tokens.js';

// Background cron for PromoCode expiry. Sets codes whose validUntil has
// passed to EXPIRED and expired redemptions to EXPIRED, and gives back the
// slots of holds whose checkout expired. The lazy paths in PromoCodesService
// remain as defense-in-depth.

@Injectable()
export class PromoCodeExpirer {
    private readonly logger = new Logger(PromoCodeExpirer.name);

    constructor(
        @Inject(PROMO_CODE_REPOSITORY_TOKEN)
        private readonly promoRepo: PromoCodeRepository,
        @Inject(PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN)
        private readonly redemptionRepo: PromoCodeRedemptionRepository,
        @Optional()
        @Inject(PROMO_CODE_HOLD_REPOSITORY_TOKEN)
        private readonly holds: PromoCodeHoldRepository | null = null,
        // Last and optional, so the shape this class was published with still
        // constructs it; without it, maintenance is not on and nothing pauses.
        @Optional()
        @Inject(MaintenanceService)
        private readonly maintenance: MaintenanceService | null = null,
        // The sweep is the installation's, not a tenant's: a row policy on the
        // redemptions — forced, in some installations — would otherwise leave
        // it expiring nothing while it reports success.
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_3AM, {
        name: 'promoCodeExpirer',
        timeZone: 'Europe/Berlin',
    })
    async expirePromoCodes(): Promise<void> {
        // A run skipped under a maintenance lock is caught up by the next one:
        // what is due then includes what was due now.
        if (await this.maintenance?.isLocked()) {
            this.logger.log(
                'PromoCodeExpirer: skipped, the application is locked for maintenance.',
            );
            return;
        }
        const now = new Date();
        const { codes, redemptions, holds } = await readAcrossTenants(this.rlsBypass, async () => ({
            codes: await this.promoRepo.expireDueCodes(now),
            redemptions: await this.redemptionRepo.expireDueRedemptions(now),
            holds: (await this.holds?.expireDue(now)) ?? 0,
        }));
        if (codes > 0 || redemptions > 0 || holds > 0) {
            this.logger.log(
                `PromoCodeExpirer: ${codes} Codes, ${redemptions} redemptions, ${holds} holds expired.`,
            );
        }
    }
}

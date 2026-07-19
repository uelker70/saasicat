import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
    PromoCodeRedemptionRepository,
    PromoCodeRepository,
} from '@saasicat/types';
import { PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN, PROMO_CODE_REPOSITORY_TOKEN } from './tokens.js';

// Hintergrund-Cron für PromoCode-Auslauf. Setzt Codes mit überschrittenem
// validUntil auf EXPIRED und abgelaufene Redemptions auf EXPIRED. Der
// lazyExpire()-Pfad im PromoCodesService bleibt als Defense-in-depth.

@Injectable()
export class PromoCodeExpirer {
    private readonly logger = new Logger(PromoCodeExpirer.name);

    constructor(
        @Inject(PROMO_CODE_REPOSITORY_TOKEN)
        private readonly promoRepo: PromoCodeRepository,
        @Inject(PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN)
        private readonly redemptionRepo: PromoCodeRedemptionRepository,
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_3AM, {
        name: 'promoCodeExpirer',
        timeZone: 'Europe/Berlin',
    })
    async expirePromoCodes(): Promise<void> {
        const now = new Date();
        const codes = await this.promoRepo.expireDueCodes(now);
        const redemptions = await this.redemptionRepo.expireDueRedemptions(now);
        if (codes > 0 || redemptions > 0) {
            this.logger.log(
                `PromoCodeExpirer: ${codes} Codes, ${redemptions} Redemptions abgelaufen.`,
            );
        }
    }
}

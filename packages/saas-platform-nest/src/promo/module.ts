// PromoCodesModule — DI-Wrapper um PromoCodesService + PromoCodeExpirer.
//
// Konsumenten reichen ihre sechs Adapter-Implementations (PromoCodeRepository,
// PromoCodeRedemptionRepository, PromoCodeValidationLogRepository,
// FirstTimeCustomerCheck, PromoSubscriptionLookup, PromoRevenueDeductionAggregator)
// + TransactionRunner + AdminConfig (`nonRedeemablePlans`) durch.
//
// PlanCatalog-Token wird aus dem PlanCatalogModule erwartet (im Konsumenten
// üblicherweise per `forRoot({ path: 'config/plans.yaml' })` geladen).

import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import type {
    FirstTimeCustomerCheck,
    PromoCodeRedemptionRepository,
    PromoCodeRepository,
    PromoCodeValidationLogRepository,
    PromoRevenueDeductionAggregator,
    PromoSubscriptionLookup,
    TransactionRunner,
} from '@saasicat/types';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { PromoCodeExpirer } from './expirer.js';
import { PromoCodePublicController } from './controller.js';
import { PromoCodesService, type PromoServiceConfig } from './service.js';
import { PromoCodeRateLimitGuard } from './rate-limit.guard.js';
import {
    PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN,
    PROMO_CODE_REPOSITORY_TOKEN,
    PROMO_CODE_VALIDATION_LOG_REPOSITORY_TOKEN,
    PROMO_FIRST_TIME_CUSTOMER_CHECK_TOKEN,
    PROMO_REVENUE_DEDUCTION_AGGREGATOR_TOKEN,
    PROMO_SERVICE_CONFIG_TOKEN,
    PROMO_SUBSCRIPTION_LOOKUP_TOKEN,
    PROMO_TRANSACTION_RUNNER_TOKEN,
} from './tokens.js';

export interface PromoCodesModuleOptions {
    promoCodeRepository: ProviderSpec<PromoCodeRepository>;
    redemptionRepository: ProviderSpec<PromoCodeRedemptionRepository>;
    validationLogRepository: ProviderSpec<PromoCodeValidationLogRepository>;
    firstTimeCustomerCheck: ProviderSpec<FirstTimeCustomerCheck>;
    subscriptionLookup: ProviderSpec<PromoSubscriptionLookup>;
    revenueAggregator: ProviderSpec<PromoRevenueDeductionAggregator>;
    transactionRunner: ProviderSpec<TransactionRunner>;
    config?: PromoServiceConfig;
    /**
     * Default `true`. Auf `false` setzen, wenn der Konsument den Cron deaktivieren
     * möchte (z. B. CLI-Boot, Test-Setups ohne ScheduleModule).
     */
    includeExpirerCron?: boolean;
    /**
     * Default `true`. Registriert `PromoCodePublicController` mit
     * `POST /billing/promo/preview`. Auf `false` setzen, wenn der Konsument
     * keine öffentliche Preview-API exposen will (z. B. SuperAdmin-only-Deploy).
     */
    includePublicController?: boolean;
    /** Modul global registrieren — Default `false`. */
    global?: boolean;
}

@Module({})
export class PromoCodesModule {
    static forRoot(options: PromoCodesModuleOptions): DynamicModule {
        const includeCron = options.includeExpirerCron ?? true;
        const includePublic = options.includePublicController ?? true;
        const providers: Provider[] = [
            asProvider(PROMO_CODE_REPOSITORY_TOKEN, options.promoCodeRepository),
            asProvider(PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN, options.redemptionRepository),
            asProvider(PROMO_CODE_VALIDATION_LOG_REPOSITORY_TOKEN, options.validationLogRepository),
            asProvider(PROMO_FIRST_TIME_CUSTOMER_CHECK_TOKEN, options.firstTimeCustomerCheck),
            asProvider(PROMO_SUBSCRIPTION_LOOKUP_TOKEN, options.subscriptionLookup),
            asProvider(PROMO_REVENUE_DEDUCTION_AGGREGATOR_TOKEN, options.revenueAggregator),
            asProvider(PROMO_TRANSACTION_RUNNER_TOKEN, options.transactionRunner),
            { provide: PROMO_SERVICE_CONFIG_TOKEN, useValue: options.config ?? {} },
            PromoCodesService,
            PromoCodeRateLimitGuard,
        ];
        if (includeCron) {
            providers.push(PromoCodeExpirer);
        }

        return {
            module: PromoCodesModule,
            global: options.global ?? false,
            controllers: includePublic ? [PromoCodePublicController] : [],
            providers,
            exports: [
                PromoCodesService,
                PromoCodeRateLimitGuard,
                PROMO_CODE_REPOSITORY_TOKEN,
                PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN,
                PROMO_CODE_VALIDATION_LOG_REPOSITORY_TOKEN,
            ],
        };
    }
}

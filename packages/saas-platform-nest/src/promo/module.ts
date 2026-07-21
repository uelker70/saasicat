// PromoCodesModule — DI wrapper around PromoCodesService + PromoCodeExpirer.
//
// Consumers pass in their six adapter implementations (PromoCodeRepository,
// PromoCodeRedemptionRepository, PromoCodeValidationLogRepository,
// FirstTimeCustomerCheck, PromoSubscriptionLookup, PromoRevenueDeductionAggregator)
// + TransactionRunner + AdminConfig (`nonRedeemablePlans`).
//
// The PlanCatalog token is expected from the PlanCatalogModule (in the consumer
// usually loaded via `forRoot({ path: 'config/plans.yaml' })`).

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
     * Default `true`. Set to `false` if the consumer wants to disable the cron
     * (e.g. CLI boot, test setups without ScheduleModule).
     */
    includeExpirerCron?: boolean;
    /**
     * Default `true`. Registers `PromoCodePublicController` with
     * `POST /billing/promo/preview`. Set to `false` if the consumer does not
     * want to expose a public preview API (e.g. SuperAdmin-only deploy).
     */
    includePublicController?: boolean;
    /** Register the module globally — default `false`. */
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

import type { DynamicModule } from '@nestjs/common';
import type { SaaSiCatPersistenceAdapter, TransactionRunner } from '@saasicat/types';

import { SuperAdminGuard } from '../../admin/super-admin.guard.js';
import type { ProviderSpec } from '../../core/di.js';
import { PromoCodesModule } from '../../promo/promo.module.js';

import { optionsOf, type CompositionContext } from './context.js';

/**
 * Promo codes, admin side and — off by default — the public preview.
 *
 * The `firstTimeCustomerCheck` fallback answers "no existing customer", which
 * makes a first-time-only code preview as unavailable rather than as free.
 * Erring towards refusing is the only safe direction for a discount.
 */
export function composePromoCodes({
    options,
    adapters,
    persistence,
}: CompositionContext): DynamicModule[] {
    if (!options.promoCodes) return [];
    const config = optionsOf(options.promoCodes);
    const promo = persistence?.promo as NonNullable<SaaSiCatPersistenceAdapter['promo']>;
    const {
        firstTimeCustomerCheck,
        adminGuards,
        imports: promoImports,
        includePublicController,
        adminController,
        ...promoOptions
    } = config;

    return [
        PromoCodesModule.forRoot({
            ...promoOptions,
            promoCodeRepository: promo.promoCodeRepository,
            redemptionRepository: promo.redemptionRepository,
            validationLogRepository: promo.validationLogRepository,
            subscriptionLookup: promo.subscriptionLookup,
            revenueAggregator: promo.revenueAggregator,
            transactionRunner: adapters.transactionRunner as ProviderSpec<TransactionRunner>,
            firstTimeCustomerCheck: firstTimeCustomerCheck ?? {
                hasExistingCustomerForEmail: async () => false,
            },
            includePublicController: includePublicController ?? false,
            adminController:
                adminController === false
                    ? false
                    : { guards: adminGuards ?? [...options.controller.guards, SuperAdminGuard] },
            imports: promoImports ?? options.imports,
        }),
    ];
}

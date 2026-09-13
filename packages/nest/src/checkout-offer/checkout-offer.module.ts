// CheckoutOfferModule — DI wrapper around the CheckoutOfferService.
//
// ```ts
// CheckoutOfferModule.forRoot({
//   checkoutOfferRepository: { useFactory: (r: PrismaCheckoutOfferRepository) => r,
//                              inject: [PrismaCheckoutOfferRepository] },
//   planRepository: { useFactory: (r: PrismaPlanRepository) => r, inject: [PrismaPlanRepository] },
//   controller: { guards: [] }, // auth-free — offer is created before tenant creation
//   imports: [PrismaModule],
// })
// ```
//
// Pricing reads the installation's currency and VAT rate from the plan
// catalogue (`PlanCatalogModule`, global under `SaaSiCatModule.forRoot`), and a
// promo code through `PromoCodesService` where the promo module is registered.

import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type {
    BundleRepository,
    CatalogEntryRepository,
    CheckoutOfferRepository,
    PlanRepository,
    PromotionRepository,
} from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import {
    BUNDLE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
    PROMOTION_REPOSITORY_TOKEN,
} from '../catalog/catalog.tokens.js';
import { CheckoutOfferPricing } from './checkout-offer-pricing.js';
import { CheckoutOfferService } from './checkout-offer.service.js';
import { buildCheckoutOfferController } from './checkout-offer.controller.js';
import { CHECKOUT_OFFER_REPOSITORY_TOKEN } from './checkout-offer.tokens.js';

export interface CheckoutOfferControllerConfig {
    /** Class-level guards; `[]` for auth-free public endpoints. */
    guards: Array<Type<CanActivate>>;
}

export interface CheckoutOfferModuleOptions {
    checkoutOfferRepository: ProviderSpec<CheckoutOfferRepository>;
    /**
     * Bundle versions an offer can book: their prices, and whether they are
     * still bookable on consume. Without it an offer carries no add-ons, and
     * one that names a bundle version is refused.
     */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /**
     * REQUIRED: the plan version on sale and its price, which every offer is
     * priced from. Also the plan features for the requires validation.
     */
    planRepository: ProviderSpec<PlanRepository>;
    /**
     * The catalogue promotions an offer applies, the same ones the public
     * catalogue shows. Without it an offer carries no promotion.
     */
    promotionRepository?: ProviderSpec<PromotionRepository>;
    /**
     * Optional for the requires validation (#35 P6): requires source =
     * curated FeatureCatalogEntries. Without wiring, the validation is
     * skipped (graceful).
     */
    catalogEntryRepository?: ProviderSpec<CatalogEntryRepository>;
    /** Controller mount for `/public/checkout-offer`. Omitted = service only. */
    controller?: CheckoutOfferControllerConfig;
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    global?: boolean;
}

@Module({})
export class CheckoutOfferModule {
    static forRoot(options: CheckoutOfferModuleOptions): DynamicModule {
        if (!options.planRepository) {
            throw new Error(
                'CheckoutOfferModule: `planRepository` is required — every offer is priced from the ' +
                    'plan version on sale, and an offer without it would have to take its price from ' +
                    'the request.',
            );
        }
        const controllers: Type[] = [];
        if (options.controller) {
            controllers.push(buildCheckoutOfferController(options.controller.guards));
        }
        return {
            module: CheckoutOfferModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers,
            providers: [
                asProvider(CHECKOUT_OFFER_REPOSITORY_TOKEN, options.checkoutOfferRepository),
                ...(options.bundleRepository
                    ? [asProvider(BUNDLE_REPOSITORY_TOKEN, options.bundleRepository)]
                    : []),
                asProvider(PLAN_REPOSITORY_TOKEN, options.planRepository),
                ...(options.promotionRepository
                    ? [asProvider(PROMOTION_REPOSITORY_TOKEN, options.promotionRepository)]
                    : []),
                ...(options.catalogEntryRepository
                    ? [asProvider(CATALOG_ENTRY_REPOSITORY_TOKEN, options.catalogEntryRepository)]
                    : []),
                CheckoutOfferPricing,
                CheckoutOfferService,
                ...(options.extraProviders ?? []),
            ],
            exports: [CheckoutOfferService, CHECKOUT_OFFER_REPOSITORY_TOKEN],
        };
    }
}

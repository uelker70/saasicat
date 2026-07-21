// CheckoutOfferModule — DI wrapper around the CheckoutOfferService (METAMODELL §17a).
//
// ```ts
// CheckoutOfferModule.forRoot({
//   checkoutOfferRepository: { useFactory: (r: PrismaCheckoutOfferRepository) => r,
//                              inject: [PrismaCheckoutOfferRepository] },
//   controller: { guards: [] }, // auth-free — offer is created before tenant creation
//   imports: [PrismaModule],
// })
// ```

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
} from '@saasicat/types';

import { asProvider, type ProviderSpec } from '../core/di.js';
import {
    BUNDLE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
} from '../catalog/tokens.js';
import { CheckoutOfferService } from './checkout-offer.service.js';
import { buildCheckoutOfferController } from './checkout-offer.controller.js';
import { CHECKOUT_OFFER_REPOSITORY_TOKEN } from './tokens.js';

export interface CheckoutOfferControllerConfig {
    /** Class-level guards; `[]` for auth-free public endpoints. */
    guards: Array<Type<CanActivate>>;
}

export interface CheckoutOfferModuleOptions {
    checkoutOfferRepository: ProviderSpec<CheckoutOfferRepository>;
    /**
     * Optional for V3 revalidation on consume: if set, the service checks
     * whether referenced bundle versions are still bookable. Also provides
     * the bundle features for the requires validation (#35 P6).
     */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /**
     * Optional for the requires validation (#35 P6): plan features of the
     * chosen plan version. Without wiring, falls back to the featuresSnapshot
     * of the plan line item.
     */
    planRepository?: ProviderSpec<PlanRepository>;
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
                ...(options.planRepository
                    ? [asProvider(PLAN_REPOSITORY_TOKEN, options.planRepository)]
                    : []),
                ...(options.catalogEntryRepository
                    ? [asProvider(CATALOG_ENTRY_REPOSITORY_TOKEN, options.catalogEntryRepository)]
                    : []),
                CheckoutOfferService,
                ...(options.extraProviders ?? []),
            ],
            exports: [CheckoutOfferService, CHECKOUT_OFFER_REPOSITORY_TOKEN],
        };
    }
}

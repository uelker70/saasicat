// CheckoutOfferModule — DI-Wrapper um den CheckoutOfferService (METAMODELL §17a).
//
// ```ts
// CheckoutOfferModule.forRoot({
//   checkoutOfferRepository: { useFactory: (r: PrismaCheckoutOfferRepository) => r,
//                              inject: [PrismaCheckoutOfferRepository] },
//   controller: { guards: [] }, // auth-frei — Offer entsteht vor Tenant-Anlage
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
    /** Class-Level-Guards; `[]` für auth-freie Public-Endpoints. */
    guards: Array<Type<CanActivate>>;
}

export interface CheckoutOfferModuleOptions {
    checkoutOfferRepository: ProviderSpec<CheckoutOfferRepository>;
    /**
     * Optional für V3-Revalidation beim Consume: wenn gesetzt, prüft der
     * Service, ob referenzierte BundleVersionen weiterhin buchbar sind.
     * Liefert außerdem die Bundle-Features für die requires-Validierung
     * (#35 P6).
     */
    bundleRepository?: ProviderSpec<BundleRepository>;
    /**
     * Optional für die requires-Validierung (#35 P6): Plan-Features der
     * gewählten PlanVersion. Ohne Wiring Fallback auf die featuresSnapshot
     * der Plan-LineItem.
     */
    planRepository?: ProviderSpec<PlanRepository>;
    /**
     * Optional für die requires-Validierung (#35 P6): requires-Quelle =
     * kuratierte FeatureCatalogEntries. Ohne Wiring wird die Validierung
     * übersprungen (graceful).
     */
    catalogEntryRepository?: ProviderSpec<CatalogEntryRepository>;
    /** Controller-Mount für `/public/checkout-offer`. Weggelassen = nur Service. */
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

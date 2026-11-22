import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { SubscriberRepository } from '@saasicat/core';

import type { ProviderSpec } from '../core/di.js';
import { tenantEditableDetailsOf } from '../subscriber/subscriber-details.js';
import { subscriberProviders } from '../subscriber/subscriber.module.js';
import { billingAreaRouteProviders } from './billing-area-routes.js';
import type { PaymentsTenantRoutesOptions } from './payments.module.js';
import { TENANT_EDITABLE_DETAILS_TOKEN } from './payments.tokens.js';
import { TenantBillingDetailsController } from './tenant-billing-details.controller.js';

export interface TenantBillingDetailsModuleOptions {
    tenantRoutes: PaymentsTenantRoutesOptions;
    subscriberRepository: ProviderSpec<SubscriberRepository>;
    /**
     * The application's modules its guard classes come from, and the one that
     * keeps the installation's joins: a joined subscriber takes no change.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /**
     * Providers registered in this module's own scope, such as the guard
     * classes `tenantRoutes.authGuards` injects: Nest resolves a factory's
     * `inject` there and nowhere else.
     */
    extraProviders?: Provider[];
}

/**
 * `GET` and `PATCH /billing/details`, whom the tenant is billed to, where no
 * payment gateway is wired. They are part of the billing area whether or not
 * payment methods are taken: an installation that invoices for a bank
 * transfer bills its tenants to an address too. Where a gateway is wired,
 * `PaymentsModule` mounts the same controller beside its own tenant routes. A
 * name in `billingDetails.tenantEditable` that is not a contact detail stops
 * the start.
 */
@Module({})
export class TenantBillingDetailsModule {
    static forRoot(options: TenantBillingDetailsModuleOptions): DynamicModule {
        const tenant = options.tenantRoutes;
        return {
            module: TenantBillingDetailsModule,
            imports: options.imports ?? [],
            controllers: [TenantBillingDetailsController],
            providers: [
                ...billingAreaRouteProviders(tenant),
                tenantEditableDetailsProvider(tenant),
                ...subscriberProviders(options.subscriberRepository),
                ...(options.extraProviders ?? []),
            ],
        };
    }
}

/** The contact details the tenant changes at `PATCH /billing/details`, checked at the start. */
export function tenantEditableDetailsProvider(tenant: PaymentsTenantRoutesOptions): Provider {
    return {
        provide: TENANT_EDITABLE_DETAILS_TOKEN,
        useValue: tenantEditableDetailsOf(tenant.billingDetails?.tenantEditable),
    };
}

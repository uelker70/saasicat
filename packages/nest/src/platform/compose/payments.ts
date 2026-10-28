import type { DynamicModule } from '@nestjs/common';

import { PaymentsModule, type PaymentsModuleOptions } from '../../payments/payments.module.js';

import { optionsOf, type CompositionContext } from './context.js';

/**
 * Payment methods through a payment gateway.
 *
 * Runs after `composeTenantBilling` and reads the guards it resolved: the
 * tenant's payment method routes are tenant routes, authenticated the same way
 * as its plan. Without tenant billing only the webhook route is mounted, and a
 * sign-up is still the way a payment method arrives. Runs after
 * `composeSubscriberJoins` too, and imports the module it leaves.
 */
export function composePayments(ctx: CompositionContext): DynamicModule[] {
    const config = ctx.options.payments;
    if (!config) return [];
    const tenantBilling = optionsOf(ctx.options.tenantBilling);
    const authGuards = ctx.shared.authGuards;
    const imports = [...(config.imports ?? ctx.options.imports ?? [])];
    // A gateway hands back the subscriber its session was opened for, which a
    // join cannot move: a confirmation follows the joins this module keeps.
    if (ctx.shared.subscriberJoinModule) imports.push(ctx.shared.subscriberJoinModule);
    return [
        PaymentsModule.forRoot({
            gateways: config.gateways,
            paymentEventLog: ctx.persistence?.payments
                ?.paymentEventLog as PaymentsModuleOptions['paymentEventLog'],
            subscriberPaymentMethodRepository: ctx.persistence?.payments
                ?.subscriberPaymentMethodRepository as PaymentsModuleOptions['subscriberPaymentMethodRepository'],
            subscriberRepository: ctx.persistence?.entitlement
                ?.subscriberRepository as PaymentsModuleOptions['subscriberRepository'],
            transactionRunner: ctx.adapters
                .transactionRunner as PaymentsModuleOptions['transactionRunner'],
            tenantRoutes: authGuards
                ? {
                      authGuards,
                      billingPermissionGuards: config.billingPermissionGuards,
                      tenantIdResolver: tenantBilling.tenantIdResolver,
                      userEmailResolver: tenantBilling.userEmailResolver,
                  }
                : undefined,
            imports,
            extraProviders: config.extraProviders,
        }),
    ];
}

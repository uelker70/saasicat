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
    assertPermissionNotUnderPayments(config);
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
                      billingPermissionGuards: tenantBilling.billingPermissionGuards,
                      tenantIdResolver: tenantBilling.tenantIdResolver,
                      userEmailResolver: tenantBilling.userEmailResolver,
                  }
                : undefined,
            imports,
            extraProviders: config.extraProviders,
        }),
    ];
}

/**
 * Refuses the boot where the billing permission is still named under
 * `payments`. It governs the whole billing area — the invoices as well as the
 * payment method — and invoices exist without a gateway, so it moved to
 * `tenantBilling`. Ignored silently, the guards the application named would be
 * dropped and the tenant's administrator alone would hold the permission.
 */
function assertPermissionNotUnderPayments(config: object): void {
    if (!('billingPermissionGuards' in config)) return;
    throw new Error(
        '`payments.billingPermissionGuards` moved to `tenantBilling.billingPermissionGuards`: ' +
            'the billing permission governs the invoices as well as the payment method. Move ' +
            'the guards there and delete them here. See docs/guides/upgrade-to-1.0.md.',
    );
}

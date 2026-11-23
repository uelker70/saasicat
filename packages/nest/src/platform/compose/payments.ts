import type { DynamicModule } from '@nestjs/common';

import {
    PaymentsModule,
    type PaymentsModuleOptions,
    type PaymentsTenantRoutesOptions,
} from '../../payments/payments.module.js';
import { TenantBillingDetailsModule } from '../../payments/tenant-billing-details.module.js';

import { optionsOf, type CompositionContext } from './context.js';
import { subscriberRepositoryOf } from './subscriber-admin.js';

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
    // A gateway hands back the subscriber its session was opened for, which a
    // join cannot move: a confirmation follows the joins this module keeps.
    const imports = withJoins(ctx, config.imports ?? ctx.options.imports ?? []);
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
            tenantRoutes: tenantRoutesOf(ctx),
            imports,
            extraProviders: config.extraProviders,
        }),
    ];
}

/**
 * Whom the tenant is billed to, where no payment gateway is wired: the billing
 * details are part of the billing area whether or not payment methods are
 * taken, and with a gateway `PaymentsModule` mounts them beside its own
 * routes. Runs after `composeTenantBilling`, whose guards it reads, and after
 * `composeSubscriberJoins`: a joined subscriber takes no change.
 */
export function composeTenantBillingDetails(ctx: CompositionContext): DynamicModule[] {
    if (ctx.options.payments) return [];
    const tenantRoutes = tenantRoutesOf(ctx);
    const subscriberRepository = subscriberRepositoryOf(ctx);
    if (!tenantRoutes || !subscriberRepository) return [];
    // Resolved from what the application gave tenant billing, whose guards
    // these routes share.
    const tenantBilling = optionsOf(ctx.options.tenantBilling);
    return [
        TenantBillingDetailsModule.forRoot({
            tenantRoutes,
            subscriberRepository,
            imports: withJoins(ctx, tenantBilling.imports ?? ctx.options.imports ?? []),
            extraProviders: tenantBilling.extraProviders,
        }),
    ];
}

/** The tenant routes of the billing area, guarded as tenant billing resolved; none without it. */
function tenantRoutesOf(ctx: CompositionContext): PaymentsTenantRoutesOptions | undefined {
    const authGuards = ctx.shared.authGuards;
    if (!authGuards) return undefined;
    const tenantBilling = optionsOf(ctx.options.tenantBilling);
    return {
        authGuards,
        billingPermissionGuards: tenantBilling.billingPermissionGuards,
        tenantIdResolver: tenantBilling.tenantIdResolver,
        billingDetails: tenantBilling.billingDetails,
    };
}

/** `imports` and the module that keeps the installation's joins, where it has one. */
function withJoins(
    ctx: CompositionContext,
    imports: NonNullable<PaymentsModuleOptions['imports']>,
): NonNullable<PaymentsModuleOptions['imports']> {
    const joins = ctx.shared.subscriberJoinModule;
    return joins ? [...imports, joins] : [...imports];
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

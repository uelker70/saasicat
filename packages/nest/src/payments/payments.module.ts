import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type {
    PaymentEventLog,
    PaymentGateway,
    SubscriberPaymentMethodRepository,
    SubscriberRepository,
    TransactionRunner,
} from '@saasicat/core';

import { BillingPermissionGuard } from '../billing/billing-permission.guard.js';
import { ComposedTenantAuthGuard } from '../billing/composed-tenant-auth.guard.js';
import {
    BILLING_PERMISSION_GUARDS_TOKEN,
    TENANT_AUTH_GUARDS_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    type TenantIdResolver,
    type UserEmailResolver,
} from '../billing/tenant-billing.tokens.js';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { subscriberProviders } from '../subscriber/subscriber.module.js';
import { PaymentCallbackService } from './payment-callback.service.js';
import { PaymentGatewayRegistry } from './payment-gateway-registry.js';
import { PaymentWebhookController } from './payment-webhook.controller.js';
import {
    PAYMENT_EVENT_LOG_TOKEN,
    PAYMENT_GATEWAYS_TOKEN,
    PAYMENT_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN,
} from './payments.tokens.js';
import { StoredPaymentReferencesCheck } from './stored-references.check.js';
import { SubscriberPaymentMethodService } from './subscriber-payment-method.service.js';
import { TenantBillingDetailsController } from './tenant-billing-details.controller.js';
import { TenantPaymentMethodController } from './tenant-payment-method.controller.js';

/** The tenant's routes for its payment method. */
export interface PaymentsTenantRoutesOptions {
    /** The application's authentication guards, as `TenantBillingModule.forRoot.authGuards`. */
    authGuards: ProviderSpec<ReadonlyArray<CanActivate>>;
    /**
     * Who holds the billing permission. Without guards, the tenant's
     * administrator (`TENANT_ADMIN`, `SUPER_ADMIN`) does.
     */
    billingPermissionGuards?: ProviderSpec<ReadonlyArray<CanActivate>>;
    /** Default: `req.user.tenantId`. */
    tenantIdResolver?: TenantIdResolver;
    /** Default: `req.user.email` — handed to the gateway when the subscriber has no invoice email. */
    userEmailResolver?: UserEmailResolver;
}

export interface PaymentsModuleOptions {
    /**
     * One adapter per account in `config/saas.yaml#payments.accounts`, by that
     * account's name — each built with its keys from the environment.
     */
    gateways: ProviderSpec<Readonly<Record<string, PaymentGateway>>>;
    paymentEventLog: ProviderSpec<PaymentEventLog>;
    subscriberPaymentMethodRepository: ProviderSpec<SubscriberPaymentMethodRepository>;
    subscriberRepository: ProviderSpec<SubscriberRepository>;
    /** The runner of the same persistence adapter the two stores above come from. */
    transactionRunner: ProviderSpec<TransactionRunner>;
    /**
     * Mounts the tenant's billing area: `GET /billing/payment-method`,
     * `POST /billing/payment-method/setup`, and `GET` and `PATCH /billing/details`.
     */
    tenantRoutes?: PaymentsTenantRoutesOptions;
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    extraProviders?: Provider[];
    /**
     * Default `true`: self-registration, wired in a module of its own, starts
     * its setups through the registry and hands its confirmations to the
     * callback service.
     */
    global?: boolean;
}

/**
 * Payment methods through a payment gateway: the webhook route every account's
 * callbacks arrive at, the registry of configured accounts, and — with
 * `tenantRoutes` — the tenant's view of its payment method.
 *
 * Reads `config/saas.yaml#payments` from `PLAN_CATALOG_SETTINGS_TOKEN`, which
 * `SaaSiCatModule.forRoot` provides globally.
 */
@Module({})
export class PaymentsModule {
    static forRoot(options: PaymentsModuleOptions): DynamicModule {
        const providers: Provider[] = [
            asProvider(PAYMENT_GATEWAYS_TOKEN, options.gateways),
            asProvider(PAYMENT_EVENT_LOG_TOKEN, options.paymentEventLog),
            asProvider(
                SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN,
                options.subscriberPaymentMethodRepository,
            ),
            asProvider(PAYMENT_TRANSACTION_RUNNER_TOKEN, options.transactionRunner),
            ...subscriberProviders(options.subscriberRepository),
            PaymentGatewayRegistry,
            PaymentCallbackService,
            SubscriberPaymentMethodService,
            StoredPaymentReferencesCheck,
            ...(options.extraProviders ?? []),
        ];
        const controllers: Type[] = [PaymentWebhookController];
        const tenant = options.tenantRoutes;
        if (tenant) {
            providers.push(
                asProvider(TENANT_AUTH_GUARDS_TOKEN, tenant.authGuards),
                ComposedTenantAuthGuard,
                BillingPermissionGuard,
                {
                    provide: TENANT_ID_RESOLVER_TOKEN,
                    useValue:
                        tenant.tenantIdResolver ??
                        ((req: unknown) =>
                            (req as { user?: { tenantId?: string | null } }).user?.tenantId ??
                            null),
                },
            );
            if (tenant.billingPermissionGuards) {
                providers.push(
                    asProvider(BILLING_PERMISSION_GUARDS_TOKEN, tenant.billingPermissionGuards),
                );
            }
            if (tenant.userEmailResolver) {
                providers.push({
                    provide: USER_EMAIL_RESOLVER_TOKEN,
                    useValue: tenant.userEmailResolver,
                });
            }
            controllers.push(TenantPaymentMethodController, TenantBillingDetailsController);
        }
        return {
            module: PaymentsModule,
            global: options.global ?? true,
            imports: options.imports ?? [],
            controllers,
            providers,
            exports: [
                PaymentGatewayRegistry,
                PaymentCallbackService,
                SubscriberPaymentMethodService,
                SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN,
            ],
        };
    }
}

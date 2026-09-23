// @saasicat/nest/payments — payment methods through a payment gateway.
//
// A gateway adapter per account in `config/saas.yaml#payments.accounts`, the
// webhook route their callbacks arrive at, and the tenant's view of what its
// subscriber pays with and whom it is billed to. `SaaSiCatModule.forRoot({ payments })` composes it;
// `PaymentsModule.forRoot` is the same module wired by hand.

export {
    PaymentsModule,
    type PaymentsModuleOptions,
    type PaymentsTenantRoutesOptions,
} from './payments.module.js';
export {
    PaymentCallbackService,
    type PaymentCallbackOutcome,
    type PaymentEventContext,
    type PaymentMethodConfirmedEvent,
    type PaymentMethodSetupFailedEvent,
    type PaymentSetupEventHandler,
} from './payment-callback.service.js';
export {
    PaymentGatewayRegistry,
    type NewPaymentMethodAccount,
    type PaymentGatewayAccount,
} from './payment-gateway-registry.js';
export {
    SubscriberPaymentMethodService,
    type StartPaymentMethodChange,
} from './subscriber-payment-method.service.js';
export {
    TenantPaymentMethodController,
    type TenantPaymentMethodView,
} from './tenant-payment-method.controller.js';
export {
    TenantBillingDetailsController,
    type TenantBillingDetailsView,
} from './tenant-billing-details.controller.js';
export { PaymentWebhookController } from './payment-webhook.controller.js';
export { DevPaymentGateway, DEV_PAYMENT_PROVIDER } from './dev-payment-gateway.js';
export {
    PAYMENT_EVENT_LOG_TOKEN,
    PAYMENT_GATEWAYS_TOKEN,
    PAYMENT_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN,
} from './payments.tokens.js';
export { StartPaymentMethodSetupDto } from './dto/start-payment-method-setup.dto.js';
export { ChangeBillingDetailsDto } from './dto/change-billing-details.dto.js';

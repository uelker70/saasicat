// DI tokens of the payments module. Every one of them is reachable from more
// than one entry — `@saasicat/nest/registration` starts a payment method setup
// through the same registry — so they sit in the global symbol registry.

/** The bound gateway adapters, by the account name `config/saas.yaml#payments.accounts` gives each. */
export const PAYMENT_GATEWAYS_TOKEN = Symbol.for('saasicat/nest/PaymentGateways');
export const PAYMENT_EVENT_LOG_TOKEN = Symbol.for('saasicat/nest/PaymentEventLog');
export const SUBSCRIBER_PAYMENT_METHOD_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/SubscriberPaymentMethodRepository',
);
export const PAYMENT_TRANSACTION_RUNNER_TOKEN = Symbol.for('saasicat/nest/PaymentTransactionRunner');

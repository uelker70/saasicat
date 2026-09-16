---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/spec': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

Take a subscriber's payment method through a payment gateway

A payment method is entered in the gateway's own form, and SaaSiCat keeps the
gateway's reference to it for the subscriber, with masked details only.
Self-registration asks for the billing address and the payment method in step
4, and activates once the gateway confirms the payment method: the account,
subscriber, tenant, subscription and payment method are written on the
transaction the confirmation is claimed on, so a failure rolls all of it back
and the gateway's retry activates.

- New `payments` block in `config/saas.yaml` naming the gateway accounts and the
  `returnUrlOrigins` a success or cancel URL has to be at, and
  `SaaSiCatModule.forRoot({ payments: { gateways } })` binding one
  `PaymentGateway` per account. `PaymentsModule` in `@saasicat/nest/payments`
  mounts `POST /webhooks/payment/:account`, which needs the application created
  with `rawBody: true` and a global auth guard that lets
  `isSaaSiCatPublicRoute` through. `DevPaymentGateway` confirms on the spot for
  development and refuses `NODE_ENV=production`.
- A start refuses gateways that do not match the accounts in the file, and a
  payment method in use or a waiting sign-up at an account no longer named.
- `GET` and `POST /billing/payment-method` behind the new billing permission,
  held by the tenant's administrator unless `billingPermissionGuards` says
  otherwise. `TenantPlanSection` shows the payment method to whoever holds it,
  through the new `useTenantPaymentMethod`.
- Breaking: `PaymentProvider`, `PaymentWebhookDto` and
  `PendingRegistrationService.handlePaymentEvent` are removed, and
  `RegistrationModule.forRoot` no longer takes `paymentProvider` or
  `paymentEventLog`. `ActivationOrchestrator.activate` receives `{ tx }` and
  writes on it; `CheckoutOfferService.conclude` takes `tx`.
  `PendingRegistrationRepository.findByCheckoutSession` takes the gateway
  account, `delete` takes `tx`, and `findOpenCheckoutAccounts` is new. A
  duplicate callback is logged, no longer audited as
  `PAYMENT_DUPLICATE_IGNORED`. `startCheckout` requires
  `billingDetails`. `PaymentEventLog.tryClaim` becomes `claim(claim, tx)`.
- A tenant's change records the setup it opened, and a confirmation is recorded
  only for the account, session and subscriber of an open setup. A gateway
  session is confirmed once, however many events report it: a partial unique
  index in `sql/constraints.postgres.sql` makes the second confirmation a
  duplicate rather than a second payment method. A confirmation that changed
  nothing gives the session back through `PaymentEventLog.releaseSession`, so
  the event that does belong to it is still handled.
- Breaking: the `SubscriptionPaymentMethod` fragment is removed.
  `SubscriberPaymentMethod`, `SubscriberPaymentMethodSetup` and
  `PaymentEventLog` are in `14-payments.prisma`;
  run `sql/1.0-a-payment-method-is-a-gateway-reference.postgres.sql` before
  `db push`, and drop `subscription_payment_methods` once nothing writes there.
- Fixed: a fresh database no longer stops at the settings migrations — the
  order-number migration leaves a database without `settings_changes` alone,
  and the table is created with its `seq`.

See `docs/guides/upgrade-to-1.0.md`.

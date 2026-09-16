---
'@saasicat/payment-stripe': minor
---

Take a payment method at Stripe

`@saasicat/payment-stripe` is the Stripe side of a gateway account: one class
behind the `PaymentGateway` port, so a sign-up or a tenant enters a card or an
IBAN in Stripe's own form and SaaSiCat keeps Stripe's reference to it with the
masked details.

- Stripe Checkout in `setup` mode for the payment methods the account offers,
  `card` and `sepa_debit`. Nothing is charged.
- A party without a customer at the account gets one, under an idempotency key
  from its own identifier, so a repeated step leaves no second customer behind;
  a party that has one keeps it.
- The callback is verified with the account's webhook signing secret before a
  field of it is read, and anything that does not verify raises
  `PaymentCallbackRejectedError`.
- `checkout.session.completed` in setup mode becomes a confirmed payment method
  — the card's network, last four digits and expiry, or the direct debit's last
  four digits, bank code and mandate reference. `checkout.session.expired`
  becomes a setup that failed. Everything else is answered as needing nothing,
  a session the application opened for its own business at the same account
  included.

Bind it in `SaaSiCatModule.forRoot({ payments: { gateways } })` under the
account name `config/saas.yaml#payments.accounts` gives it, point that
account's webhook endpoint at `POST /webhooks/payment/<account>`, and keep the
keys in the environment.

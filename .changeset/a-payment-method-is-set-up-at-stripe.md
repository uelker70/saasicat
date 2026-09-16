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
  made of its identifier and what is being asked for it, so a request whose
  answer was lost repeats into the same customer; a party that has one keeps
  it.
- The callback is verified with the account's webhook signing secret before a
  field of it is read, and anything that does not verify raises
  `PaymentCallbackRejectedError`.
- `checkout.session.completed` in setup mode becomes a confirmed payment method
  — the card's network, last four digits and expiry, or the direct debit's last
  four digits, bank code and mandate reference. `checkout.session.expired`, and
  a setup that produced no payment method — an intent back at
  `requires_payment_method` after a decline, or `canceled` — become a setup that
  failed.
- Answered as needing nothing: a session the application opened for its own
  business at the same account, an event of another type, a payment method whose
  shape SaaSiCat has nowhere to put, and a delivery older than twelve hours
  about a setup that has settled on none of those states. Asking again would
  read the same answer, and Stripe turns off an endpoint that keeps failing,
  which would take every other sign-up at the account with it; what is dropped
  that way names the setup it was. Raised so Stripe asks again: a delivery
  inside those twelve hours about a setup still on its way, and an error from
  Stripe itself. Raised as defects: a completed setup session without a setup
  intent, a succeeded intent without a payment method, and a completed setup
  neither the session nor the intent names a customer on.

Bind it in `SaaSiCatModule.forRoot({ payments: { gateways } })` under the
account name `config/saas.yaml#payments.accounts` gives it, point that
account's webhook endpoint at `POST /webhooks/payment/<account>`, and keep the
keys in the environment. `stripe` is a peer dependency, so the application
installs it and there is one copy of it.

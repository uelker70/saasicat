# @saasicat/payment-stripe

## What this is

The Stripe side of a SaaSiCat gateway account: one class behind the
`PaymentGateway` port, so a sign-up or a tenant takes a payment method in
Stripe's own form and SaaSiCat keeps nothing but Stripe's reference to it with
the masked details.

- **Stripe Checkout in `setup` mode** for the payment methods the account
  offers — `card` and `sepa_debit`. Nothing is charged: the session sets up a
  payment method for later.
- **One customer per party.** A party with no customer at the account gets one,
  under an idempotency key made of its identifier and what is being asked for
  it, so a request whose answer was lost repeats into the same customer. A
  party that already has one keeps it, and the new payment method joins the
  ones Stripe holds for it.
- **The callback is verified before a field of it is read**, with the account's
  webhook signing secret. Anything that does not verify raises
  `PaymentCallbackRejectedError`, which the platform answers with `400`.
- **`checkout.session.completed`** in setup mode becomes a confirmed payment
  method: the card's network, last four digits and expiry, or the direct
  debit's last four digits, bank code and mandate reference.
  **`checkout.session.expired`** becomes a setup that failed, so the sign-up
  can try again. Everything else is answered as needing nothing — including a
  session the application opened for its own business at the same account, and
  a setup Stripe has not finished or whose payment method is neither a card nor
  a direct debit. Nothing is raised at a callback that verifies: Stripe turns
  off an endpoint that keeps failing, and that would take every other sign-up
  at the account with it.

`stripe` is a peer dependency: the consumer installs it, so there is one copy
and the optional `client` option types against theirs.

```ts
import { StripePaymentGateway } from '@saasicat/payment-stripe';

SaaSiCatModule.forRoot({
    payments: {
        gateways: {
            // The account name is the one `config/saas.yaml#payments.accounts` gives it.
            'stripe-main': new StripePaymentGateway({
                secretKey: process.env.STRIPE_SECRET_KEY,
                webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
                currency: 'EUR',
            }),
        },
    },
});
```

Point the account's webhook endpoint at `POST /webhooks/payment/stripe-main`,
subscribe it to `checkout.session.completed` and `checkout.session.expired`,
and create the application with `rawBody: true` — a signature is checked
against the bytes that arrived, not against a re-serialised object.

## What this is not

Not a billing integration. It sets up a payment method and reports what Stripe
confirmed; it draws no invoice, charges nothing, and knows no prices. It also
takes only payment methods that are set up in one go — a mandate a bank rejects
days later is not reported here, and arrives with the collection that step 4 of
[#276](https://github.com/uelker70/saasicat/issues/276) brings. Stripe
Billing, Stripe's own invoices, subscriptions, tax and customer portal stay
unused — SaaSiCat keeps the commercial record itself, and the gateway holds the
means of payment. It is also not a place for keys: the secret key and the
webhook secret come from the environment, because `config/saas.yaml` refuses to
carry a credential.

## Next

- [Wire the backend](../../docs/guides/wire-the-backend.md) — the payments block, the webhook route
  and the tenant's payment method
- [The subscriber owns the commercial record](../../docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md)
  — why a payment method is a reference

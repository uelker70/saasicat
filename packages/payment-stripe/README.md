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
  **`checkout.session.expired`**, and a setup that produced no payment method
  — an intent back at `requires_payment_method` with the decline recorded
  against it, or `canceled` — become a setup that failed, so the sign-up can
  try again. An intent asking for a payment method with nothing recorded
  against it is one nobody has confirmed yet, and is asked about again rather
  than reported.
- **What is answered, and what is raised.** Answered as needing nothing: a
  session the application opened for its own business at the same account, an
  event of another type, a payment method whose shape SaaSiCat has nowhere to
  put, and a delivery older than twelve hours about a setup that has settled on
  none of the states above. Asking again would read the same answer, and Stripe
  turns off an endpoint that keeps failing, which would take every other
  sign-up at the account with it; what is dropped that way says in its own name
  which setup it was. Raised, so that Stripe asks again: a delivery inside
  those twelve hours about a setup still on its way — `processing` while a
  mandate is registered, an action outstanding — because the state is read
  after the delivery and failing it is what brings the next read. Raised as
  well, as the defects they are: a completed setup session without a setup
  intent, a succeeded intent without a payment method, and a completed setup
  neither the session nor the intent names a customer on. An error from Stripe
  itself travels the same way, and the delivery is asked again.

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

### Every method the file names has to be live at the account

`config/saas.yaml#payments.accounts.<name>.methods` reaches Stripe as
`payment_method_types`, unchanged, and Stripe reads that list as a whole. Name
one method the account has not activated — `sepa_debit` sitting at
`available: false` in the dashboard's payment-method settings, which is where it
stays until Stripe's own verification for it is done — and the session is refused
before it opens. Not that method: the
session. The card nobody had a problem with goes with it.

Nothing on this side can see that. The start checks the file against the bound
adapters, and neither knows what the account is cleared for, so the first sign
of it is a customer who cannot enter a payment method at all. Name what is live,
and add a method when the account is cleared for it — `methods: [card]` is the
honest starting point for an account that is not.

Stripe recommends against `payment_method_types` and points at
`payment_method_configurations` and dynamic payment methods, which decide the
list at their end. This adapter sends the list anyway, and the reason is the one
the rest of SaaSiCat is built on: `config/saas.yaml` is where an installation's
decisions live, and a list maintained in a provider's dashboard would be a second
place the same decision could be made — and disagree. The cost is the paragraph
above, and it is the cost being chosen rather than overlooked.

### Where the two secrets come from

They are not the same kind of thing, and only one of them has to be fetched by
hand.

`STRIPE_SECRET_KEY` does: no API creates an API key, so somebody reads it off
Stripe's dashboard. Stripe recommends a **restricted key** (`rk_…`) over a secret
one. What this adapter touches, so you can grant that and no more: customers
(write), checkout sessions (write), setup intents (read) — and the setup intent is
read with `payment_method` and `mandate` expanded, which Stripe lists as their own
permissions. Grant from Stripe's own list rather than from this sentence: a
`checkout.session.completed` whose expansion the key may not follow throws where
the confirmation is read, every delivery then fails, and Stripe disables an
endpoint that keeps failing.

`STRIPE_WEBHOOK_SECRET` does not: `POST /v1/webhook_endpoints` creates the
endpoint and returns its signing secret, so the part described just above — point
it at the route, subscribe it to the two events — is scriptable end to end.

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

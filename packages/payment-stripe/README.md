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
  put, and an event older than twelve hours about a setup that has settled on
  none of the states above. Asking again would read the same answer, and Stripe
  turns off an endpoint that keeps failing, which would take every other
  sign-up at the account with it; what is dropped that way says in its own name
  which setup it was. Raised, so that Stripe asks again: an event less than
  twelve hours old about a setup still on its way — `processing` while a
  mandate is registered, an action outstanding — because the state is read
  after the delivery and failing it is what brings the next read. Raised as
  well, as the defects they are: a completed setup session without a setup
  intent, a succeeded intent without a payment method, and a completed setup
  neither the session nor the intent names a customer on. An error from Stripe
  itself travels the same way, and the delivery is asked again. Two of those
  are also what a key that may not follow the `payment_method` expansion
  produces — the succeeded intent without a payment method, and the error from
  Stripe where it refuses the read rather than answering with a bare id — and a
  withheld permission does not come good on a later delivery. Read both beside
  [what a restricted key can fail](#where-the-two-secrets-come-from) before
  concluding the gateway sent something wrong.

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

### One Stripe account per installation

Stripe delivers an event to every endpoint on the account subscribed to that
type, and there is no way to send it to one application's endpoint only:

> It's not possible to restrict webhook events for specific applications when
> using a single Stripe account. All events will be sent to all webhook
> endpoints on the account that listen for that event type. The recommended
> approach is to use separate Stripe accounts for each application or website.

— Stripe support, retrieved 2026-09-17.

A sibling's callback cannot move what matters: a confirmation carries its
account, its session and its subject, and one from the installation next door
matches no open setup here, so no payment method changes hands and no sign-up is
activated. What it does instead depends on what each installation runs, and the
worst of it is not a log line: an installation that has not wired
`RegistrationModule` answers a neighbour's sign-up events with `500`, Stripe
retries those and then disables the endpoint — the one carrying your own
confirmations.
[The guide](../../docs/guides/wire-the-backend.md) has the whole account, path by
path.

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
permissions.

Creating the webhook endpoint through the API, as the end of this section
describes, needs its own write permission beside those.

Grant from Stripe's own list rather than from that sentence, and the expansions
are the two that go missing: they are never fetched on their own, so a reader
deriving permissions from the calls does not see them. A key that may not follow
them throws where a confirmation is read — so **every completed setup that
produced a payment method** fails, which is every payment method anybody sets up.
What keeps answering `200` beside it is everything that never reaches that read:
an expired checkout, any completed session that is not a setup or carries no
subject of ours, and — where the expansion comes back as a bare id rather than the
read being refused outright — a setup that failed or is still on its way, both of
which are decided before the payment method is looked at. So a declined card gets
a working "try again" from an endpoint on which no successful setup gets through:
it looks partly healthy, and Stripe eventually disables it — taking the deliveries
that did work with it.

**A grant is only proved by using it.**
Nothing at start-up can check a key — it is a string until Stripe answers — and
the call that needs the expansions runs when somebody finishes a form. Two things
make a wrong grant hard to see afterwards, so they are worth knowing before you
write one:

- **The two expansions fail differently.** `payment_method` throws when it does
  not resolve, so a missing permission shows up as a failed delivery.
  `mandate` appears not to: a mandate that arrives as a bare id leaves the payment
  method recorded and the delivery at `200`, with only the mandate reference
  missing from the record. A card never reads it at all — it records no mandate
  reference by design — so any run with a card says nothing about that permission
  whatever it answers. An account cleared for cards alone therefore cannot prove
  it at all: check the grant again the day `sepa_debit` goes live, because the
  first direct debits after that are where a missing `mandate` shows up, and they
  show up green.
- **A status code is not the message, and the message can point the wrong way.**
  Two answers name themselves: a callback for an account nothing is registered
  under is `404` with its code, and one that does not verify is `400` with its
  code. What is raised while the confirmation is read says nothing in the
  response — a bare internal error at `500` — so nothing there tells those apart;
  the sentence is in the application's log. Two of those failures say what they
  are: the deliberate raise for a setup intent still settling — the ordinary
  course for a direct debit whose mandate takes hours to register — names the
  session and the intent's status, and a subject nothing here handles names the
  missing handler. The rest are the defects listed at the top of this page, and
  Stripe's own errors.

    A withheld permission hides among that rest, which is the trap. If an expansion
    the key may not follow comes back as a bare id — the reading the bullet above
    rests on — a withheld `payment_method` reaches the log as **this adapter's** own
    sentence — `Stripe reported setup intent … as succeeded without a payment method.`
    — which the top of this page lists as a defect of the gateway; if Stripe refuses
    the read instead, it arrives as an error of Stripe's, which that same list files
    next to it. That list is where a reader holding one of those sentences lands, and
    it names this cause beside both: so when either appears on a key that has just
    been changed, suspect the grant before Stripe.

So exercise it against the test account, through a **new sign-up** — an existing
subscriber already has a customer, and customers-write would go unexercised — for
each method the account offers, and check the payment method that ends up on the
tenant rather than the delivery that produced it. A direct debit **with** a
mandate reference is the grant proved. Without one, look further before
concluding: the reference is also absent for a mandate Stripe has not attached or
one carrying no direct-debit reference, and a grant corrected after a green
delivery is proved by another sign-up rather than by re-sending the same event,
which is recorded already and answers `200` unchanged.

The rest of the choreography — forwarding with `stripe listen`, which secret it
signs with, re-sending an event at all — is Stripe's tooling rather than this
adapter's behaviour, and it is not written down here because it is not verified
here. How long an unsettled setup is worth asking about again is not in that
list: it is twelve hours from the moment Stripe created the event, it belongs to
this adapter, and it is at the top of this page.

What any of it proves is the permission set, not the key: a restricted key belongs
to one mode, so the live key is a different object granted the same way. It is the
grant that is easy to get wrong.

`STRIPE_WEBHOOK_SECRET` does not: `POST /v1/webhook_endpoints` creates the
endpoint and returns its signing secret, so registering it — the route, and the
two event types this adapter reads — is scriptable end to end.

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

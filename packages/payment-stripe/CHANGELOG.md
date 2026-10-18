# @saasicat/payment-stripe

## 1.0.0-rc.27

### Minor Changes

- 3cca4f4: A payment is recorded once, and a credit is paid out by the operator

    What a collection brought is recorded with its outcome, on one transaction and
    in the invoice's turn: the payment, once, by its gateway account and the
    gateway's reference, whether the run asking or the gateway's callback reports
    it first, and however often (`SC-PRIC-029`). It settles what its invoice still
    owes; what it brought beyond that is a credit on the subscriber's account, and
    so is an invoice whose total is negative, which the quarter-hourly run credits
    right after issuing it. A credit is never offset against a later invoice: the
    operator pays it out, by a refund in the gateway — recorded against the credit
    its payment left first, then the oldest, and given back when it fails — or,
    where the gateway can no longer refund, by a transfer recorded on the tenant's
    page (`SC-PRIC-083`). SaaSiCat initiates neither.

    `subscriber_payments`, `subscription_invoice_settlements`, `subscriber_credits`,
    `subscriber_credit_entries` and `subscriber_refunds` come with fragment 24 and
    `1.0-a-payment-is-recorded.postgres.sql`, behind the new
    `SubscriberPaymentRepository`, which `SaaSiCatModule` takes from
    `persistence.entitlement.subscriberPaymentRepository` for
    `chargeJournal.invoices.payments`; collecting now requires it.

    A success in `CollectionOutcome` names what the gateway received, as
    `amountCents` and `currency`. `PaymentGatewayEvent` gains
    `collection-reported` and `refund-reported`, and the Stripe adapter maps
    `payment_intent.succeeded`, `.processing`, `.payment_failed`, `.canceled` and
    `refund.created`, `.updated`, `.failed` to them, each read again from Stripe;
    a restricted key needs refunds (read). A success reported for an attempt
    recorded as failed is recorded too: the attempt succeeds and what was planned
    after it is withdrawn. An invoice that owes nothing is collected no further:
    no attempt is started, planned or sent for it, and a failure beside the payment
    is followed up without a notice. A request that never reached the gateway is
    settled rather than sent again where its invoice was paid meanwhile, audited as
    `SUBSCRIPTION_INVOICE_COLLECTION_ABANDONED`, and is not sent where a report
    settled it meanwhile: `abandonPaid` answers `'abandoned'`, `'resend'` or
    `'settled'`. `InvoiceCollectionRepository` gains `findByKey` and `abandonPaid`,
    and a refund in another currency than its payment is refused.

    The operator reads a subscriber's credits on the tenant's page
    (`GET admin/tenants/:slug/credits`, `credits.read`) and records a payout
    against one with the second factor
    (`POST admin/tenants/:slug/credits/:creditId/payouts`, `credits.payout`),
    refused beyond what the credit owes (`SUBSCRIBER_PAYOUT_EXCEEDS_CREDIT`), on a
    day still to come (`SUBSCRIBER_PAYOUT_NOT_MADE_YET`) and for another
    subscriber's credit (`SUBSCRIBER_CREDIT_NOT_FOUND`).

- 20c3991: A reversal takes a payment back, and what matched nothing is reconciled

    A direct debit the bank returned and a chargeback are recorded as reversals of
    the payment they take back, once however often and in whatever order they are
    reported (`SC-PRIC-084`, superseding `SC-PRIC-031`): the credit the payment left
    goes first — its open part shrinks it, a part already paid out is a case to
    reconcile —, then an open credit another payment collected for the same invoice
    left (`SC-PRIC-087`), and only what remains opens the invoice again; reversals
    of two payments of one invoice end alike in either order (`SC-PRIC-088`). The
    attempt that collected the payment is then `REVERSED`, also one that had failed
    before its payment arrived late: once no other attempt of the invoice is on its
    way, the next run tells the subscriber at the invoice email, as a
    `CollectionReversedNotice` through `InvoiceMailPort.tell`, and the invoice is
    collected again only with a payment method none of its payments was reversed on
    (`SC-PRIC-085`); an attempt of it that succeeded is marked `REVERSED` as well,
    so it keeps no other from being made, and its payment method then collects that
    invoice no more either, even where its own payment was not reversed
    (`SC-PRIC-088`). A dispute won takes its reversal back part for part — the cases
    it opened first, then the credit, then the invoice —, and what the invoice no
    longer owes because it was paid meanwhile becomes a credit (`SC-PRIC-086`).

    What the gateway reports and no credit matches — the part of a refund no credit
    takes, the part of a reversal that meets a credit already paid out — is a case
    to reconcile: on the administration's new reconciliation page and on the
    tenant's page beside its invoices with what each still owes, closed by the
    operator with a note behind the second factor (`SC-ADM-033`). A refund that
    fails and a reversal given back close the cases they opened.

    Fragment 24 gains `SubscriberReversal` and `SubscriberReconciliationCase`, and
    the columns that name a reversal on the settlements, the credit entries and the
    credits; `1.0-a-payment-is-recorded.postgres.sql` creates and adds them where
    its earlier version ran. `SubscriberPaymentRepository` gains `recordReversal`,
    `listCases`, `closeCase`, `owedByInvoices`, `findReversalById` and
    `accountsHoldingCredits`; `InvoiceCollectionRepository` gains `markReversed`.
    `PaymentGatewayEvent` gains `reversal-reported`, which the Stripe adapter maps
    from `charge.dispute.*`; a restricted key needs disputes (read). The routes
    `GET admin/reconciliation`, `POST admin/reconciliation/:caseId/close` and
    `GET admin/tenants/:slug/payments` come with the capabilities
    `reconciliation.read`, `reconciliation.close` and `payments.read`; the codes
    `SUBSCRIBER_RECONCILIATION_CASE_NOT_FOUND` and
    `SUBSCRIBER_RECONCILIATION_CASE_CLOSED` are new. The start refuses while a
    credit not paid out is held at an account `config/saas.yaml` no longer names
    (`SC-PRIC-030`).

- f453f75: An invoice is collected through its payment gateway

    Where `config/saas.yaml` names `payments`, an invoice that announced how it is
    paid is collected through the gateway account its payment method is held at, as
    the fourth step of the quarter-hourly run, once it was mailed: by card at once,
    by direct debit from the collection date it announced (`SC-PRIC-082`).

    A collection never charges twice (`SC-PRIC-034`). Each attempt is started in
    the invoice's turn and written as submitted, with everything its request
    carries, before the request leaves; an invoice has one attempt not settled at a
    time and none after one succeeded. Every request carries the key
    `saasicat:collect:<invoice>:<attempt>`. A request whose answer was lost is asked
    about at the gateway fifteen minutes later, and sent again as the same request
    only where the gateway holds nothing under its key; a direct debit on its way is
    asked about once an hour. A failure is recorded with its reason and the
    gateway's code, and what follows it is `SC-PRIC-080`'s.

    `PaymentGateway` gains `collect` and `findCollection`, which
    `@saasicat/payment-stripe` implements with payment intents confirmed off
    session under the attempt key, and `DevPaymentGateway` in memory. A restricted
    Stripe key needs payment intents (write) and charges (read) beside what it had.
    The Stripe gateway now refuses a currency Stripe does not take to the cent,
    such as `JPY` or `ISK`, and answers an invoice in another currency than its
    account's as failed with the code `saasicat_other_currency`, without sending
    anything.

    Adopt `23-subscription-invoice-collection.prisma`, run
    `1.0-an-invoice-is-collected.postgres.sql` once before `db push`, and pass
    `persistence.entitlement.invoiceCollectionRepository` as
    `tenantBilling.chargeJournal.invoices.collections`; the start refuses invoices
    without it where the file names `payments`, and refuses to start while a
    collection not settled was sent to an account the file no longer names
    (`SC-PRIC-030`). A persistence contract harness gains
    `invoiceCollectionRepository`, or declares `gaps: ['invoiceCollections']`.

### Patch Changes

- Updated dependencies [5396ab6]
- Updated dependencies [3ab58af]
- Updated dependencies [3cca4f4]
- Updated dependencies [20c3991]
- Updated dependencies [f453f75]
- Updated dependencies [9c9f624]
- Updated dependencies [e183f06]
    - @saasicat/core@1.0.0-rc.27

## 1.0.0-rc.26

### Patch Changes

- Updated dependencies [c4ad49a]
- Updated dependencies [5f9d90b]
- Updated dependencies [dd102b5]
- Updated dependencies [917b4dc]
    - @saasicat/core@1.0.0-rc.26

## 1.0.0-rc.25

### Patch Changes

- Updated dependencies [5f7a41b]
- Updated dependencies [5a4e6ca]
- Updated dependencies [d34e3e5]
- Updated dependencies [b4a961d]
- Updated dependencies [3258251]
- Updated dependencies [5776198]
- Updated dependencies [8fe675c]
- Updated dependencies [8683c32]
- Updated dependencies [cf12963]
- Updated dependencies [808cd9f]
- Updated dependencies [3496864]
    - @saasicat/core@1.0.0-rc.25

## 1.0.0-rc.24

### Patch Changes

- Updated dependencies [05b9e78]
- Updated dependencies [f7839c2]
- Updated dependencies [ce7241e]
- Updated dependencies [49e93ab]
- Updated dependencies [109fcce]
- Updated dependencies [f78c15d]
- Updated dependencies [b17333a]
- Updated dependencies [fe07088]
- Updated dependencies [f905b7f]
- Updated dependencies [21ba667]
- Updated dependencies [c69e2af]
- Updated dependencies [381c516]
- Updated dependencies [60e875d]
- Updated dependencies [d556622]
- Updated dependencies [c3b87c8]
- Updated dependencies [4470181]
- Updated dependencies [edb496b]
- Updated dependencies [8a3ee1d]
- Updated dependencies [2cafe45]
- Updated dependencies [b152580]
- Updated dependencies [7063891]
- Updated dependencies [a576414]
- Updated dependencies [e444a9b]
- Updated dependencies [7cd9d27]
- Updated dependencies [e99d6c0]
- Updated dependencies [71937ba]
- Updated dependencies [42b21ab]
- Updated dependencies [c25f062]
- Updated dependencies [5a6b34a]
- Updated dependencies [536982d]
    - @saasicat/core@1.0.0-rc.24

## 1.0.0-rc.23

### Patch Changes

- Updated dependencies [a748f74]
- Updated dependencies [da4b3b3]
    - @saasicat/core@1.0.0-rc.23

## 1.0.0-rc.22

### Patch Changes

- Updated dependencies [82c5ab6]
- Updated dependencies [3663719]
- Updated dependencies [37899b2]
- Updated dependencies [123ea4d]
    - @saasicat/core@1.0.0-rc.22

## 1.0.0-rc.21

### Minor Changes

- 4264bfd: Hold a promo code for a checkout until the payment is confirmed

    A sign-up concluded its checkout offer when the gateway confirmed the payment
    method, and redeemed the offer's promo code there. When the code's last
    redemption went to somebody else in between, the redemption refused, the
    conclusion was undone, and the customer had entered a payment method for
    nothing.

    - `startCheckout` takes `checkoutOfferId`, the offer the sign-up concludes.
      The offer's promo code is held from that step, before the gateway's form
      opens, until a confirmation of that form can no longer arrive — at Stripe
      the form's 24 hours plus the three days Stripe retries a webhook — so an
      abandoned form gives its slot back once nobody can pay on it. A code that
      cannot be held refuses the step with `PROMO_CODE_NOT_REDEEMABLE` and its
      `reason`, and no form is opened. A start that fails gives back at once the
      slot it took; a slot a form opened before holds stays with that form, and
      starting step 4 again never shortens it.
      `CheckoutOfferService.holdPromoCode` takes a hold directly.
    - Breaking: `PaymentMethodSetupSession` carries `confirmableUntil`, the last
      moment a confirmation of the session can arrive, or `null` for a gateway
      that states none, which holds the slot for the checkout's lifetime.
      `StripePaymentGateway` reports the session's `expires_at` plus Stripe's
      three days of webhook retries; a gateway adapter of your own has to state
      it.
    - The conclusion redeems the code on the held slot, as the application's
      `redeemInTransaction` in `within` runs today — also when the code was paused
      or ran past its validity since the checkout started. A slot the conclusion
      does not redeem is given back before it commits, and a conclusion that fails
      keeps the slot for its retry.
    - A held slot counts against `maxRedemptions` beside the redemptions. A code
      whose remaining slots are held refuses new checkouts with `EXHAUSTED` and
      stays `ACTIVE`, and gets its slots back as checkouts conclude, change their
      code or their holds run out. The admin list shows the held slots beside the
      redemptions, the statistics carry `held`, and a code a checkout holds a slot
      of is not deleted.
    - Breaking: `PromoCodeRecord` carries `heldCount`; a `PromoCodeRepository` of
      your own reports 0 when it keeps no holds. Holds are the new
      `PromoCodeHoldRepository`, which both shipped adapters provide as
      `promo.holdRepository`, and which the persistence contract holds against
      PostgreSQL — declare `gaps: ['promoCodeHolds']` in a harness without it.
    - Run `sql/1.0-a-promo-slot-is-held-through-checkout.postgres.sql` before
      `db push`: it adds `promo_codes.heldCount` and the `promo_code_holds` table,
      and does nothing on a second run.

    Changing a promo code is held to the rules creating one is: a percentage
    between 0 and 100, an amount above 0 and below the lowest price it can apply to
    unless an invoice of zero is allowed. Redeeming refuses where the preview
    refuses, with `WOULD_PRODUCE_ZERO_INVOICE`, and records at most the price it is
    redeemed against. A change that only pauses a code is always accepted.

### Patch Changes

- Updated dependencies [07c30c6]
- Updated dependencies [877faa4]
- Updated dependencies [4264bfd]
- Updated dependencies [6a83734]
- Updated dependencies [d64bf82]
    - @saasicat/core@1.0.0-rc.21

## 1.0.0-rc.20

### Patch Changes

- @saasicat/core@1.0.0-rc.20

## 1.0.0-rc.19

### Patch Changes

- Updated dependencies [99cbb89]
    - @saasicat/core@1.0.0-rc.19

## 1.0.0-rc.18

### Minor Changes

- f7411ad: Take a payment method at Stripe

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
      `requires_payment_method` with the decline recorded against it, or `canceled`
      — become a setup that failed. One asking for a payment method with nothing
      recorded against it is one nobody confirmed yet, and is asked about again.
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

### Patch Changes

- @saasicat/core@1.0.0-rc.18

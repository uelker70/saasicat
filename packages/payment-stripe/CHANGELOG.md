# @saasicat/payment-stripe

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

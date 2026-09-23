---
'@saasicat/core': major
'@saasicat/spec': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/payment-stripe': minor
---

Hold a promo code for a checkout until the payment is confirmed

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

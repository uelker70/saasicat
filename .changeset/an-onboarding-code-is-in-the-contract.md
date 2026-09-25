---
'@saasicat/nest': patch
'@saasicat/adapter-drizzle': patch
---

A promo code redeemed at onboarding is recorded in the contract

The contract written after onboarding redeemed a code named only the plan and
the add-ons, at the list price. The first contract written after a redemption
now records the code: a generated discount line with the values it was
redeemed at, resolved against the plan the way an offer resolves it, and the
code in `promoCodeSnapshots` (`SC-PROMO-025`). Where onboarding went into a
trial, that is the contract written at activation. Later contracts do not
repeat it, and a contract concluded from an offer with the code already
records it.

The subscriber's account takes it off: it reads each discount from the
earliest contract that records it, not only from a contract concluded from an
offer, so two discounts agreed at different times each run from their own
contract, and one carried forward into later contracts does not start again
(`SC-PRIC-057`).

- `PromoCodesService.redeemedCodeFor(subscriptionId)` returns the code a
  subscription redeemed, with the values it was redeemed at, unless the
  redemption was reversed. An expired redemption still counts: its term ran
  from the subscription's start, before a trial, while a contract counts a
  discount from the first period that is paid.
- `promoCodeDiscountNet` in `@saasicat/nest/promo` resolves what a code takes
  off a plan's net price; offers and contracts use it alike.
- `@saasicat/adapter-drizzle` writes the moments the database used to fill —
  `createdAt`, `redeemedAt` and the others — on the application's clock, and
  compares a plan version's end with it. Left to the database, a session
  outside UTC put them hours off, because the canonical columns carry no time
  zone. An installation whose session runs outside UTC converts its old
  redemptions once with
  `sql/1.0-a-redemption-is-redeemed-in-utc.postgres.sql`, after the old
  version has stopped and before the new one starts.

---
'@saasicat/core': minor
'@saasicat/nest': major
'@saasicat/ui-vue': patch
---

Round money from the decimals it was written as, once, half away from zero

Amounts the platform derives were rounded in binary floating point, so a value
ending on half a cent went down whenever its binary form lay just below it:
5 % of 20.10 came out as 1.00, and 11.50 net at 19 % as 13.68 gross. Offer,
preview and contract agreed with each other and not with a decimal
calculation of the same agreement — a cent off what an accountant or an import
into the bookkeeping arrives at (`SC-PRIC-061`).

- `@saasicat/core` computes money exactly: `percentOf`, `prorate`,
  `grossFromNet`, `netFromGross`, `computeIncludedVat`, `roundToCents`,
  `sumToCents` and `toCents` read each amount and rate as the decimal it
  prints as, add, multiply and divide as integers, and round once to the cent,
  half away from zero.
- Every place the platform rounded money goes through them: a promo code's
  percentage and fixed discounts, gross and net, the tax a gross amount holds,
  proration, the offer's sums, the configurator's prices, a contract line's
  gross, the charges, and the marketing page's display.
- A percentage promotion now takes off the discount rounded, as a promo code
  does, rather than rounding the reduced price: 5 % off 20.10 is 19.09 either
  way. The two rules differed by a cent on a half.
- An offer priced before the upgrade keeps the amounts it was written with.
  Where its gross, or the discount a percentage promotion took off, lands on a
  half cent, concluding it is refused with `CHECKOUT_OFFER_PRICE_NOT_CURRENT`
  and the customer asks for a new offer; a contract never states other totals
  than its offer.
- A contract written before the upgrade keeps its money. A `--full` refresh of
  one whose gross or line tax lands on a half cent reports a money change and
  is refused with `MONEY_WOULD_CHANGE`; the default refresh, features only,
  carries the money over as written.
- `grossFromNet`, `netFromGross` and `computeIncludedVat` from
  `@saasicat/nest` are the core functions under the same names. `round2` is
  gone: import `roundToCents` from `@saasicat/core`.

---
'@saasicat/core': major
'@saasicat/nest': major
---

The sign-up configurator shows the yearly price the plan version carries

`computeBreakdown` computed a yearly subtotal as the monthly price times
`cycleDiscount`, while the offer and the contract charge the plan version's
`yearlyNet`. A plan at 9.99 a month and 99.00 a year was shown at 99.90, and a
promo code preview worked on that figure.

- The yearly subtotal is the model's `yearlyNet`; the saving is twelve monthly
  prices minus it, never below zero.
- `ConfiguratorCatalog.cycleDiscount` and
  `ConfiguratorMarketingProvider.getCycleDiscount()` are removed. Delete the
  method from a marketing provider, and display the server's breakdown or
  `model.yearlyNet` where a page computed from `cycleDiscount`.
- A promo discount is gross, as the preview reckons it, and the breakdown takes
  it off in net, as the offer does. `RegistrationPromoPreview.discountAmount` is
  documented as that gross amount.
- Consuming a checkout offer checks its promo code with the promo module as it
  stands then, and a code it no longer accepts refuses the offer with
  `CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED` rather than
  `CHECKOUT_OFFER_PRICE_NOT_CURRENT`, whose prices still match.

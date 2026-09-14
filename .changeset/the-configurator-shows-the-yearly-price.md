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
- Consuming a checkout offer checks its promo code with the promo module as it
  stands then, which was already so and is now documented.

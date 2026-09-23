---
'@saasicat/nest': major
'@saasicat/core': major
---

A contract's lines add up to its totals, and a promotion lowers a price and
nothing else

A contract's total was converted to gross once, from the net total, while each
line was converted on its own. For a plan and one add-on at 19 % the lines
missed the total by a cent in about one price pair in five: 10.02 + 10.02 net
gave lines of 11.92 + 11.92 = 23.84 under a total of 23.85, and with a discount
line a contract totalling 0 had lines coming to −0.01. The tax is now computed
once on the net of the charges billed together, and each line carries its share
of it, at most a cent from its own conversion (`SC-PRIC-050`). What a customer
pays does not change for a contract of one rhythm.

- A contract mixing rhythms is taxed per rhythm. A yearly plan at 100.00 with a
  monthly add-on at 10.02 states 262.04 gross — one charge of 119.00 and twelve
  of 11.92 — where a single conversion of the year's net stated 262.09.
- Breaking: `SubscriptionContractService.create` refuses a contract whose lines
  do not add up to `subtotalNet`, `discountNet`, `totalNet` and `totalGross`,
  each line counted as often as it falls due in one period, with
  `SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP`. It refuses a negative discount,
  or a promotion or promo code snapshot resolved below zero, with
  `SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE` (`SC-PRIC-051`). Both platform paths
  always pass; an application that builds its own lines records them with
  `recordContractLinesMoney` and states its totals with `contractTotalsOf`.
- Breaking: `recordLineItemMoney` is gone from
  `@saasicat/nest/subscription-contract`, replaced by
  `recordContractLinesMoney(lines, { currency, taxRate })`, which records the
  gross of every line of a contract at once. `PricedContractLineItem` no longer
  carries `priceGross`.
- Breaking: `ContractFreezeSourcePort.loadBookedBundles(tenantId, cycle)` takes
  no `vatRate`, and its lines carry no `priceGross`: the platform computes the
  gross. An adapter that still declares the third parameter stops compiling,
  which is where to drop the gross it computes.
- A checkout offer shares its lines' gross the same way, and the check that an
  offer is still priced as the catalogue prices it no longer compares a line's
  gross, which it derives. An offer stored with lines converted one by one
  still concludes.
- A catalogue promotion never takes off more than the price it meets, and one
  that takes nothing off is not shown: `applyPromo` keeps its result between 0
  and the base price and answers `null` where nothing is taken off. A
  promotion of 150 % on a plan at 30 beside an add-on at 20 took 45, fifteen of
  them off the add-on, and the public catalogue showed a negative price.
- Breaking: creating or changing a promotion refuses a value its type cannot
  take with `PROMOTION_VALUE_INVALID`: a percentage above 0 and at most 100, an
  amount above 0, an intro price of at least 0 for a whole number of months, a
  whole number of free months (`SC-MKT-026`).

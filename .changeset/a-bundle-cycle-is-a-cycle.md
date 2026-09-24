---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
---

A bundle booking's rhythm is `MONTHLY` or `YEARLY`

The platform writes a booking's `billingCycle` only as `MONTHLY` or `YEARLY`,
and prices a booking by asking whether it is `YEARLY` — yet the record typed it
as any string, so an implementation could hand back `'yearly'` and have the
booking priced monthly without a word.

- Breaking: `SubscriptionBundleRecord.billingCycle` and
  `CreateSubscriptionBundleData.billingCycle` are `BillingCycle | null`.
  `resolveBundlePriceNet`, `SubscriptionBundlesService.listForSubscription` and
  `SubscriptionBundlePreviewContext.billingCycle` take a `BillingCycle`.
- Both shipped adapters read a booking through `toSubscriptionBundleRecord`,
  new in `@saasicat/core`, which refuses a stored rhythm other than the two,
  naming the row. A `SubscriptionBundleRepository` of your own can map its rows
  with it.
- Breaking: the persistence contract checks that refusal. A harness gives it
  the `setBookingCycle` seed writer, or names `foreignBookingCycleSeed` in
  `gaps`.

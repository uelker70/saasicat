---
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/adapter-prisma': minor
'@saasicat/core': minor
---

Close the last gaps in `@saasicat/adapter-drizzle`: it now serves the plan catalogue, the tenant's own subscription writes, and subscription contracts, so the persistence contract runs against it with no scenario skipped.

`drizzlePersistence()` now returns the `catalog` and `tenantBilling` slices, so `SaaSiCatModule.forRoot` can discover the plan catalogue, the tenant's billing page and the writes behind its buttons without a consumer wiring any of it by hand. Four classes are new: `DrizzlePlanRepository`, `DrizzleTenantSubscriptionWrite`, `DrizzleSubscriptionContractRepository` and `DrizzleSubscriptionUsageAdapter`. The `subscriptions` query map was also missing nineteen canonical columns, including `currentPeriodEnd`, `billingAnchorDay`, `minimumTermUntil` and `trialEndsAt`; a new derived test compares every `pgTable` against the reference schema and fails on an omitted or invented column.

The persistence contract's contract-lifecycle scenario was a placeholder that failed if an adapter provided the repository at all. It is now two real scenarios — what a contract stores and what ending one does, and how a successor takes over — and both adapters plus the in-memory reference implementation pass them.

`@saasicat/core` gains the pieces both adapters were spelling out separately: `toPlanRow`, `toPlanVersionRow`, `toSubscriptionContractRecord` and `toContractLineItemRecord` map canonical rows to records in one place, `previousUtcDay` and `ACTIVE_SUBSCRIPTION_CONTRACT_STATUSES` are the window and status rules the adapters share, and `CancelSubscriptionInput`/`CancelSubscriptionResult` name a shape that was written out three times. `cancelSubscription` keeps the same structural signature.

Two read-then-write windows in the tenant's own writes are closed in **both** adapters: an ordinary cancellation no longer restates the status it read a moment earlier — a trial going live in between came back as `TRIAL`, entitlements and all — and an immediate plan change now locks the row its decisions come from.

One reading changes as a consequence: a `publishedChanges` column holding something other than an array now reads as `null` in the plan-catalogue projections rather than being cast, which is what the other mappers already did.

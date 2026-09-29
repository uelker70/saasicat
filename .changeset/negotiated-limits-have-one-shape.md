---
'@saasicat/spec': patch
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/adapter-prisma': patch
'@saasicat/adapter-drizzle': patch
'@saasicat/persistence-testing': major
---

Give negotiated limits one shape, and report a stored value in any other

The subscription fragment documented `customLimits` as
`{ maxUsers?, maxVehicles?, maxStorageGb?, features? }`, while the
platform reads `{ quotas?: { <quotaKey>: number }, features?: string[] }`
— and `@saasicat/core` itself declared both. A consumer that followed the
fragment stored limits the entitlement read nothing from, without an error.

- `CustomLimits` in `@saasicat/core` is the one type, used by `Subscription`
  and `SubscriptionRecord`. `CustomLimitsShape` is gone from
  `@saasicat/nest/entitlement`; use `CustomLimits`. `Subscription.customLimits`
  was declared flat, which nothing ever read; it now has the shape that is
  applied.
- Both adapters read the stored JSON through `readCustomLimits`. A quota goes
  through the same reading as a plan quota, and a key the platform does not
  read is left out and named in a warning, once per subscription: the tenant
  stays on its plan's limits rather than being blocked, and the operator sees
  what was not applied.
- A quota value nothing can count still reads as unlimited, as a plan's does,
  and is named in that warning too.
- The fragment, `examples/notesapp` and the normative admin API schema document
  the shape that is read: `customLimits` in the application's subscription
  `PATCH` route and in `SubscriptionDetail` was a flat map of integers, and now
  refers to a `CustomLimits` schema. A repository test holds that schema to
  `CUSTOM_LIMITS_KEYS`, the keys the platform reads.
- The persistence contract reads negotiated limits back, in the platform's
  shape and in one it does not read. Its `createSubscription` seed writer
  takes `customLimits`; a harness of your own writes it to the column.

---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/ui-vue': patch
---

Sell an add-on version by its dates, as a plan version is

Which version of an add-on is on sale is now decided by its dates, as for a
plan (`SC-BUN-035`, superseding `SC-BUN-023`): published, begun, not past its
last day, and — once superseded — only within a last day it carries. The
public catalogue and the upsell showed the newest published version, and a
booking refused every superseded one, so an add-on whose successor starts next
month could not be sold until then, while a version whose start was still to
come could be booked at once. The public catalogue, the upsell, the add-on
preview, checkout and a tenant's booking now read it the same way.

- `@saasicat/adapter-prisma`: the `bundle` option of `prismaPersistence()`,
  the options argument of `PrismaBundleRepository`,
  `PrismaBundleRepositoryOptions` and `PRISMA_BUNDLE_REPOSITORY_OPTIONS` are
  removed; the dates are always written and read, so the bundle-version model
  carries `validFrom` and `validUntil` as the shipped fragment does.
- `@saasicat/adapter-drizzle`: the `bundle` option of `drizzlePersistence()`
  and the options argument of `DrizzleBundleRepository` are removed.
- `@saasicat/core`: `BundleRepository.findActiveBundleVersion` is required.
  A new code, `BUNDLE_VERSION_NOT_YET_ON_SALE`, refuses a booking of a version
  whose start is still to come.
- `@saasicat/nest`: a superseded add-on version is booked until its successor
  starts. `FakePlanRepository` and `FakeBundleRepository` answer the version on
  sale by the adapters' rule, including the one for a superseded version
  without a last day. A version's start and end are days: publishing a plan or
  an add-on version with a time of day is refused with its `…_VALID_FROM_INVALID`
  or `…_VALID_UNTIL_INVALID`, which would otherwise leave the hours before it
  with neither the predecessor nor the successor on sale.
- `@saasicat/ui-vue`: the add-on admin calls a version live while it is on
  sale — a predecessor until its successor starts, for the whole of its last
  day — rather than superseded from the moment a successor is published.

---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
---

Sell a plan version by its dates, everywhere

Which version of a plan is on sale is now decided once, by its dates —
published, begun, not past its last day, not ended — and the tenant's plan
list, the plan-change preview, the public catalogue, checkout, the add-on
preview, every booking, the offer to existing subscribers and the entitlement
fallback all ask that question (`SC-PLAN-027`). Switches used to decide whether
the dates were kept at all; off by default, a version published with a later
start was sold at once, and with them on, the plan list and the preview showed
the newest version while a booking bound its predecessor. The dates now always
apply.

- `@saasicat/adapter-prisma`: `schema.planVersionFields` (with `catalog` and
  `entitlement`), `tenantSubscription.activeVersionSelection`,
  `tenantSubscription.withEndsAt` and the types
  `PrismaPlanVersionFieldOptions` and `PrismaPlanVersionFieldCapabilities` are
  removed. Every plan-version model carries `validFrom`, `validUntil` and
  `endsAt`; `findActivePlanVersion`, `terminate` and `findActive` are always
  there.
- `@saasicat/adapter-drizzle`: the `plan: { validityWindows }` option of
  `drizzlePersistence()`, the options argument of `DrizzlePlanRepository` and
  `DrizzlePlanRepositoryOptions` are removed; the entitlement read gains
  `findActive`.
- `@saasicat/core`: `PlanVersionRepository.findLatestLive` is removed and
  `findActive` is required; `PlanCatalogReadSink.loadSnapshot(asOf)` takes the
  moment and answers `versionsOnSale` instead of `livePlanVersions`;
  `toPlanVersionRow` takes no field flags and `PlanVersionMappingFields` is
  removed; `PlanVersionRow.endsAt` is always present.
- `@saasicat/nest`: the plan editor and checkout refuse to start over a plan
  repository without `findActivePlanVersion`. `FakePlanVersionRepository`
  drops `findLatestLive`.
- `@saasicat/persistence-testing`: a new part, `planCatalogRead`, holds the
  catalogue read to the version a booking binds; a harness wires
  `planCatalogReadSink` or names the part in `gaps`.

Nothing to migrate: a version without dates counts as on sale since it was
published, and the next one published with a start date closes it on the day
before. A superseded version is on sale only within a last day it carries, so
ending the successor of an undated one leaves nothing on sale rather than
bringing back the old price.

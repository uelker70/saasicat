---
'@saasicat/nest': major
'@saasicat/core': major
'@saasicat/cli': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/spec': patch
---

Read the plans when an operation asks for them, not when the application starts

On the database path the plan catalogue was read once, at start, and every
service kept that reading. A plan the operator published afterwards was unknown
until the next restart: a promo code for it was refused with `PLAN_MISMATCH`, a
plan change to it with `PLAN_NOT_IN_CATALOG`, and a contract frozen after a
price change named the new version while recording the old one's price,
features and quotas. `SC-PLAN-026` is the promise that replaces it.

- Breaking: `PLAN_CATALOG_TOKEN` is gone. `PLAN_CATALOG_SETTINGS_TOKEN` carries
  the settings of `config/saas.yaml`, which are fixed while the process runs.
  `PLAN_CATALOG_SOURCE_TOKEN` carries a `PlanCatalogSource`, whose `current()`
  reads the plans and features as they stand. Read it once per operation and
  hand the value on. The token was removed rather than narrowed, because Nest
  does not type an injection: a token that kept its name and lost its plans
  would have compiled and answered every `catalog.plans ?? []` with an empty
  list.
- Every platform service that reads plans reads them per operation: promo code
  preview, creation and redemption, the plan change preview, the contract
  freeze, the entitlement computation (for `plannedOnly`), the static
  entitlements, the public plan list and the admin manifest. `enforceLimit`
  reads before it opens its transaction, so the lock it holds on the
  subscription row does not wait for a second connection.
- Breaking: `AdminManifestConfig` has no `planCatalogSnapshot`. The service
  fills it on every request, with a hash over what it carries, so the ETag
  moves when a plan is published. `AdminManifestService.getManifest()` and
  `rebuild()` return a `Promise`, and the service needs a `PlanCatalogModule`
  in scope — `SaaSiCatModule.forRoot` provides one globally; an
  `AdminManifestModule` wired by hand imports one beside it.
- Breaking: `ManifestAccessPort.getManifest()` and `rebuild()` return a
  `Promise`, and `ManifestCliFlow.dump()`, `hash()`, `validate()` and `diff()`
  are asynchronous. A `manifestAccessPort` that delegates to
  `AdminManifestService` needs no change: the flow awaits it.
- Breaking: `PlanCatalogDoctorCheck` takes a `PlanCatalogSource` and reports
  a catalogue that cannot be read as an error.
- Plans and features that share a `sortOrder` are ordered by their key. The
  catalogue is read for every operation now, and a tie the database breaks
  differently from one read to the next would reorder the plans between a
  preview and the change it describes. Where two of yours share a value, the
  order you see may change once.
- Breaking: a contract records the plan version its subscription is bound to.
  The freeze priced the plan line from the version on sale, so a tenant on v1
  who booked an add-on after v2 was published got a contract at v2's price
  with v1's entitlements (`SC-SUB-012`). `ContractFreezeSourcePort` replaces
  `findLivePlanVersionId(planId)` with `findBoundPlanVersion(tenantId)`, and
  the freeze refuses a plan the subscription is not bound to before it closes
  the contract in force. That relies on the write binding `planVersionId` on a
  plan change: `TenantSubscriptionWritePort.bindsPlanVersion` says whether it
  does, and a freeze beside a write that says `false` stops the start.
- Breaking: `@saasicat/adapter-prisma` binds the plan version on a plan change
  by default — `tenantSubscription.synchronizePlanVersion` defaults to `true`,
  as the Drizzle adapter has always behaved, and `false` opts out. A
  subscription's `planVersionId` then follows the plan it was changed to, so
  an upgraded tenant's entitlements come from the version they bought rather
  than the one they left. The persistence contract holds each adapter's
  `bindsPlanVersion` to what its write does.
- `EntitlementService.computeLimits` takes an optional catalogue. With it, the
  answer is computed from that reading and kept out of the cache both ways;
  the freeze passes its reading. A tenant's cached entitlements may otherwise
  be up to a minute old, which is the one lag `SC-PLAN-026` allows.
- `listPriceNet(plan, cycle)` states the list-price rule `getPlanPriceNet`
  applies, for a plan already in hand. A price a version row does not carry —
  a nullable column in an installation's own schema — reads as no price rather
  than `NaN`.
- The promo preview reads the catalogue only once the code itself has passed,
  so trying codes that do not exist costs no read of the plan tables.
- `settingsSubtreeOf` accepts `PlanCatalogSettings` as well as a whole
  catalogue.
- `givenPlanCatalogSource(catalog)` builds a source over a fixed catalogue, for
  a test that constructs a service by hand. `forRootWithCatalog` uses it.

What it costs: one read of the three catalogue tables for each operation that
needs plans. The start still reads once, so a sink that cannot read stops the
boot rather than the first customer. The catalogue is now read inside tenant
requests: a row-level security policy on `plans`, `plan_versions` or
`feature_catalog_entries` — none ships — would shrink it there.

`docs/guides/upgrade-to-1.0.md` has the migration, with a before and after.

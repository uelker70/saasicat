---
'@saasicat/adapter-prisma': patch
'@saasicat/nest': minor
'@saasicat/persistence-testing': major
---

Reading a plan's versions by a key no plan has answers empty

With `planBinding: { mode: 'normalized-plan-id' }`, `PrismaPlanRepository`'s
`listVersions`, `findCurrentDraft`, `findLatestLivePlanVersion` and
`findActivePlanVersion`, and `PrismaPlanVersionRepository`'s `findLatestLive`
and `findActive`, threw `Plan '…' not found.` for a key no live plan had. A
plan removed between listing the catalogue and reading its versions turned
publishing a bundle version into a server error, and the versions of a retired
plan could not be listed at all.

- A key no plan row has now reads as an empty list or `null`.
- A retired plan's versions stay readable, as they already were in the legacy
  binding and in `@saasicat/adapter-drizzle`: the guard that decides whether a
  plan may be deleted counts them.
- Writes to a plan that is not live still refuse. `PlanVersionsService`
  refuses to create a draft for a retired plan, or to publish one left over
  from before it was retired, with `PLAN_NOT_FOUND`: `POST /plans/:planId/versions`
  and publishing a plan version answer 404 for a retired plan, on every
  adapter.
- The exported `PrismaPlanBindingResolver` interface gains the member
  `findStoragePlanId`; a hand-written implementation of it adds one.
- The persistence contract checks both, so an adapter that throws for an
  unknown key, or hides a retired plan's versions, now fails it.

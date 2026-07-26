---
'@saasicat/adapter-prisma': patch
'@saasicat/nest': patch
---

Make the plan-catalog snapshot deterministic, and close two gaps in the
shared-CJS-bundle work.

- `PrismaPlanCatalogReadSink` ordered plans and feature entries by `sortOrder`
  alone — not a total order, so rows sharing a value came back in whatever
  order Postgres picked, and the live plan-version query had no ordering at
  all. The snapshot feeds the admin-manifest hash, so two processes reading
  identical data disagreed on the hash: `GET /admin/manifest` and a CLI
  `manifest hash` could never be compared. All three queries now carry a
  deterministic tiebreaker.
- The public entry list is derived from `package.json` `exports` instead of
  being repeated in the tsup config, the stub generator and the identity test.
  A new entry that was added to only some of those copies kept its own
  duplicated CJS bundle — silently reintroducing the split class identities the
  shared bundle exists to prevent. The build now fails with an actionable
  message instead.
- `globalFeatureGuard`'s documentation named the wrong class. The option
  unbinds `StaticFeatureGuard`, not `FeatureGuard` — they are different
  classes backed by different entitlement paths — and neither the JSDoc nor
  the migration guide said that a replacement guard MUST be bound. An app
  following the old wording would have left every `@RequireFeature` route
  serving unlicensed traffic.

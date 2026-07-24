---
'@saasicat/spec': minor
'@saasicat/types': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

Remove the obsolete `PlanVersionsPage`, its standard navigation manifest key,
and the synthetic client-side catalog snapshot projection. Plan lifecycle and
per-plan version history remain in `PlansPage`; `MarketingCatalogPage` remains
the separate marketing projection.

Retain the reusable catalog timeline and diff components behind a presentation
contract that can consume immutable Publication Archive / Catalog History
snapshots from issues #30 and #35.

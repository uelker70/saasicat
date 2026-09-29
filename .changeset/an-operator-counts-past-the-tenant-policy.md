---
'@saasicat/core': patch
'@saasicat/nest': patch
---

Count across tenants inside the RLS bypass, so a booked version stays locked

The counts an operator's screens rest on span every tenant, and the platform
now reads them inside `RlsBypassPort`: how many subscriptions a plan version or
an add-on version binds, the tenant column of the plan list, and the dashboard's
subscription, promo code and audit figures. Before, they ran in the request's
own scope. On an installation whose `subscriptions` table carries a tenant
policy, that scope sees no rows, so every count read 0 — and a published version
that starts in the future and has nobody on it may still be edited. The terms
tenants had been told about, and some had accepted, could be rewritten.

- Whether the frame lifts a policy is up to your `RlsBypassPort` and the
  database layer behind it. The middleware recipe shipped with
  `@saasicat/adapter-prisma` lifts only `find*` queries, and these are counts:
  if your adapter lifts the policy itself for them today, keep it until your
  bypass demonstrably covers `count`.
- A `CatalogModule` or `AdminStatsModule` wired by hand needs an
  `RlsBypassPort` in scope under row-level security; without one it counts in
  the request's scope, as before. `SaaSiCatModule` provides it.

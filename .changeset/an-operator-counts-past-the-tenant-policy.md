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

- An adapter of your own no longer has to lift the policy itself for
  `countByPlanVersionId`, `countByBundleVersionId`, `countActiveByPlanKey` and
  the stats ports; the port documentation says the platform does.
- A hand-wired `CatalogModule` or `AdminStatsModule` without an `RlsBypassPort`
  in scope reads plainly, as before.

---
'@saasicat/nest': patch
'@saasicat/core': patch
'@saasicat/adapter-prisma': patch
---

Read a tenant's access state and plan the same in every row-level frame

The checks of a tenant's request run in guards and interceptors, before the
application's interceptor opens the tenant's frame, where a policy on the
platform's tables does not see the request's tenant. They now read through
`RlsBypassPort` where one is bound, by the tenant they are asked about
(`SC-SEC-019`), so each answers the same in a guard, a handler, a job and an
operator's route.

- `TenantAccessService` reads a tenant's reasons, and what they name — an
  invoice's number, whether an invoice is open, an ended subscription's
  deletion day — through the bypass. The operator's suspension is recorded
  through it too, and reactivating finds the suspension and lifts it in one
  frame.
- `SubscriptionPlanResolver`, behind `StaticFeatureGuard` and
  `EnforceQuotaInterceptor`, reads the subscription through the bypass, which
  it takes as an optional fourth argument; `SaaSiCatModule` passes the bound
  port.
- `EntitlementService.computeLimits`, behind `FeatureGuard`, reads the
  subscription, its contract in force and its add-ons through the bypass, in
  one frame, cached or not. A `tenantContextRunner` set for that purpose is no
  longer needed where the port is in scope.
- `TenantAccessModule.forRoot` takes `imports`, so a module wired by hand
  reaches the `RlsBypassPort` of a module it imports; `EntitlementModule`
  reaches it through its `imports` as before. `SaaSiCatModule` provides the
  port already.
- `QuotaProvider.count` and an `adapters.planResolver` of your own stay yours,
  in whatever frame the platform calls them in. Under row-level security, count
  and read by the tenant id passed, or let the interceptor that opens your
  frame run before the platform's; the integration guide says how Nest orders
  them.
- A port that only calls through reads in the caller's frame. With a policy on
  the platform's tables, bind one that lifts it — the Prisma bundle's
  `rlsIntegration: true` — or let the policy pass the platform's reads.

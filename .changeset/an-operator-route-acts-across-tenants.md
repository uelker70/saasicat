---
'@saasicat/nest': minor
---

Run every operator route the platform mounts inside the RLS bypass

An operator's routes act for the platform rather than for a tenant, but the
ones the platform mounts ran in whatever frame the installation opened for the
request. Under a forced row policy the operator's tenant list, contract list
and counts came back empty, which reads exactly like nothing (`SC-SEC-015`).

- Every route the platform mounts behind its operator guard chain — the one
  holding `SuperAdminGuard` — runs inside the installation's `RlsBypassPort`.
  The frame follows from the chain rather than from a list, and the
  administrator check runs before it opens. A tenant's route and a public one
  are left in the frame the installation opened.
- The materialisation of scheduled plan changes runs inside the bypass too, as
  the promo sweep and the contract refresh already do: it reads and writes
  every tenant's change.
- `AdminBypassRlsInterceptor` takes its port as optional and runs the route as
  it is where none is bound, so a module wired by hand without `AdminModule`
  still starts. A port that is bound is called: an installation without row
  policies binds one that runs the work as it is,
  `{ runWithBypass: (work) => work() }`, not an empty object.

- A guard chain an installation sets for a module the platform mounts —
  `adminResources.guards`, `promoCodes.adminGuards`, `adminStats.guards` —
  runs its routes in the bypass where it holds `SuperAdminGuard`; keep it in.

The bypass frame is now the innermost frame of an operator's request, so a
port that keeps more than the flag in it — the user, the tenant — carries that
over rather than replacing it: `run({ ...getStore(), bypassRls: true }, fn)`.

An installation that lifted the policy for these routes itself — around a
repository, say — can drop that, and should: a repository that reads across
tenants on every call does so for a tenant's request as well.

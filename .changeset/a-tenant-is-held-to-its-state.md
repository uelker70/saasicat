---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

A tenant is held to its state on every request

SaaSiCat now keeps the reasons a tenant is held back — a suspension, an invoice
overdue past its grace period, a subscription that ended, a deletion under way
— and checks every tenant request against the strictest of them: read-only
refuses a write, a suspension refuses everything, and the operator acting as
the tenant is held back only by a deletion. This release brings the record and
the check; the reasons arrive with the releases that bring them.

Breaking for an installation with `tenantBilling`:

- add `TenantAccessHold` from `prisma-fragments/28-tenant-access-hold.prisma`,
  run `sql/1.0-tenant-access-holds-are-kept.postgres.sql` and apply
  `constraints.postgres.sql`; the start refuses a bundle without
  `persistence.core.tenantAccessHolds`, which both shipped adapters provide
- call `TenantAccessService.enforce(context, tenantId)` at the end of your own
  authentication guard, and `assertAllowed` at sign-in and in scheduled jobs
- mark a route that writes nothing under a writing method with
  `@WritesNothing()`, and a `GET` that writes with `@Writes()`

The platform's own tenant routes check the same state behind the application's
guards. A refusal is a `403` with `TENANT_READ_ONLY`, `TENANT_SUSPENDED` or
`TENANT_BEING_DELETED` and the open reasons in `params.reasons`.
`FakeTenantAccessHoldRepository` in `@saasicat/nest/testing` keeps the reasons
in memory for tests. The upgrade guide has the steps.

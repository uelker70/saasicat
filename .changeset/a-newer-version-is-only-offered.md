---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/spec': major
'@saasicat/adapter-prisma': major
'@saasicat/adapter-drizzle': major
'@saasicat/persistence-testing': major
'@saasicat/ui-vue': major
'@saasicat/ui-vue-tenant': major
---

Retire the pending version: a newer version is only offered

A subscription keeps its plan version across every renewal until the
subscriber takes another (`SC-SUB-024`); a newer version is an offer beside
the plan (`SC-SUB-020`). The pending version — set by a notice job, accepted by
the tenant, rolled forward at the end of the term — is gone with everything
that carried it.

- `POST billing/subscription/accept-pending-version`,
  `TenantSubscriptionWritePort.acceptPendingPlanVersion`,
  `useTenantBilling().acceptPendingPlanVersion`, `PendingVersionBanner`, the
  seven `pendingVersion*` strings of `TenantPlanSectionI18n`, the error code
  `NO_PENDING_PLAN_VERSION` and its refusal `noPendingPlanVersion` are removed.
  A switch is taken through `POST billing/version-offer/accept`.
- `decideRenewal` and `clearPendingPlanVersionFields` are removed; a renewal
  keeps the version, and `computeNextPeriod` stays.
- `SubscriptionUsageRecord`, `GET billing/usage` and `Subscription` carry no
  `pendingPlanVersion*` fields. `prisma-fragments/01-subscription.prisma` and
  `03-plan-versions.prisma` drop the seven columns and their relation, and
  `sql/1.0-a-newer-version-is-only-offered.postgres.sql` drops them from an
  existing database — run it once nothing reads them any more; it discards
  every pending version still recorded, accepted ones included.
- `countByPlanVersionId` counts the version a scheduled change will bind
  (`pendingChangeVersionId`) beside the version bound, so an operator cannot
  edit a version somebody's switch is waiting for. Both adapters count it, and
  the persistence contract holds a store of your own to it; the harness seed
  writes it as `pendingChangeVersionId`.

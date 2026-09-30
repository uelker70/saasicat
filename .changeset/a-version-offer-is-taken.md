---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

Take a version offer: switch a subscription to a newer version of its plan

`POST billing/version-offer/accept` takes the offer `GET billing/version-offer`
shows (`SC-SUB-021`). The body names the version the page showed; the offer is
read again, and the switch goes ahead only while that version is still the one
offered — otherwise `409 VERSION_OFFER_CHANGED` with the offer as it now
stands. The route asks for the tenant's administrator and writes an audit
entry (`SWITCH_PLAN_VERSION`, or `SCHEDULE_PLAN_VERSION_SWITCH`).

- **An improvement and more for more** switch at once, on the plan and in the
  rhythm the subscription has. The term and the period stay. What it costs is
  what the account charges for any contract taking effect inside a paid
  period: the difference for the rest of the period where the price in the
  subscriber's own rhythm is higher, nothing where it is not — so an
  improvement is free, and so is a version dearer only in the other rhythm.
  Where contracts are frozen, the successor contract is written at once.
- **One that takes something away** is scheduled for the end of the term,
  bound to the version offered, and written when it comes due. It is refused
  with `400 PLAN_CHANGE_BLOCKED` (`QUOTA_OVER_TARGET`) while today's usage
  exceeds a quota it lowers, and with `409 VERSION_SWITCH_AFTER_CANCELLATION`
  where a cancellation lands before it would take effect.
- `PendingPlanMaterializationService` binds the version a due change names,
  also where the plan stays; a change that names none keeps the version bound,
  as before.
- `useTenantBilling().acceptVersionOffer(planVersionId)` in `@saasicat/ui-vue`
  takes it and reloads; the result type is `VersionSwitchResult` from
  `@saasicat/core`.
- The switch is written only while the subscription is as it was read. Three
  optional fields on `TenantSubscriptionWritePort` carry that:
  `expectedPlanVersionId` (on both writes) claims the row only while it is
  still bound to that version, `expectedPendingPlan` (on `schedulePlanChange`)
  only while that change — `null` for none — is still what is scheduled, and
  `quotedVersionOnly` (on `changePlanImmediate`) binds `quotedPlanVersionId`
  or nothing, instead of the version in effect. A write
  that finds any of them moved answers `claimed: false`, and the route answers
  `VERSION_OFFER_CHANGED` with the offer as it stands, or
  `SUBSCRIPTION_CHANGED`. A plan change a second administrator makes at the
  same moment is therefore refused rather than written back over.
- Both adapters implement the three, and the persistence contract holds them
  to it: a newer version of the same plan a change was quoted at is bound; a
  binding that moved, a required version that stopped taking bookings, and a
  schedule or binding that moved under a scheduled change each claim nothing.

**If you implement `TenantSubscriptionWritePort` yourself**, honour the three
fields — the contract suite in `@saasicat/persistence-testing` now asks for
them. A write that ignores them lets a version switch overwrite a plan change
made at the same moment.

**If your `PendingPlanQueryPort` does not return `pendingChangeVersionId`**, a
switch taken at the end of the term comes due as a change that keeps the
version bound — return the column, as a scheduled change to another plan
already needs.

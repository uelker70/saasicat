---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': major
---

Bind a scheduled change to another plan at the version it was quoted at

A change scheduled for the end of the term bound whichever version of the
target plan was in effect the day it came due. A version published in between
reached the customer through a change they had confirmed at another price
(`SC-CHG-022`).

- The plan-change preview prices another plan at its version live now, read as
  a row, and names it as `target.planVersionId`; a change that keeps the plan
  names the version it keeps.
- `schedulePlanChange` takes `pendingChangeVersionId` and stores it; the
  subscriptions table gains the column, with a foreign key to `plan_versions`.
  `1.0-a-scheduled-change-keeps-its-quoted-version.postgres.sql` adds it to an
  existing installation and gives a change already scheduled to another plan
  the version live when it runs.
- `ImmediatePlanChangeInput` takes `quotedPlanVersionId`: where set, and no
  version is kept by `keepsBoundVersion`, the write binds it rather than the
  version in effect. Materialisation passes the recorded version; a sale and
  onboarding pass `null`.
- `DuePendingPlanChange` requires `pendingChangeVersionId`. A
  `PendingPlanQueryPort` of your own returns it, and a
  `TenantSubscriptionWritePort` of your own stores, clears and binds it; the
  persistence contract checks the binding against PostgreSQL.

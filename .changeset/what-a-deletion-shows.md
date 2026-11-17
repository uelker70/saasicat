---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

The operator sees where a tenant's deletion stands, and the tenant what it keeps

Wherever `adminResources` and `tenantBilling` are on, the operator sees on the
tenant's page and in its subscriber's record whether the tenant's deletion is
scheduled, due, halted, under way, being retried or done (`SC-ADM-058`). A
halted deletion names every reason that holds it and the act that lets it go
on — on a database not yet marked as the installation's, the command that marks
it; a contract that runs past the end; the store that took part of the
commercial record, with each part before and after. Before the day, the page
says what would hold the deletion were the day today: the preview before
marking (`SC-PRIV-021`). The subscriber's record keeps the record of a begun
deletion, also once the application no longer has the tenant (`SC-ADM-021`):
each store's counts, the commercial record before and after, what the tenant
was told to keep, when the export was offered and whether a suspension kept it
from being taken, the reminders and the downloads — by role and number, never
by person (`SC-PRIV-024`, `SC-CANC-022`).

The tenant's users read in the banner of the read-only period what the tenant
keeps for obligations of its own, in their language with `en` as the fallback
(`SC-PRIV-022`).

- `@saasicat/nest` serves `GET admin/tenants/:slug/deletion` and
  `GET admin/subscribers/:id/deletions`, announced as `deletions.read`, and
  `GET billing/access/keep` for every user of the tenant, which asks the
  `TenantKeepReportPort` within ten seconds and shows nothing where it fails.
  `@saasicat/nest/billing` adds `TenantDeletionAdminModule`,
  `TenantDeletionReadingService`, `TenantKeepReadingService`,
  `TenantKeepController` and `KEEP_REPORT_READ_TIMEOUT_MS`.
- The deletion run decides through the same functions the pages read. It no
  longer asks the `TenantKeepReportPort` for a tenant a contract holds, and it
  says a held deletion in one line naming every reason, when it first holds,
  when what holds changes, and otherwise once a day.
- `@saasicat/core` adds `TENANT_DELETION_CAPABILITY`, `tenantDeletionStatusOf`,
  `deletionDayHasCome`, `deletionGoesOn`, `deletionHeldBy`,
  `deletionHeldByTheMark`, `TENANT_DELETION_PLATFORM_FAILURE_CODES`,
  `isTenantDeletionPlatformFailureCode`, `COMMERCIAL_RECORD_FIELDS`,
  `TenantKeepView` and the view types `AdminTenantDeletion`,
  `AdminTenantDeletionRecord` and `AdminSubscriberDeletions`.
  `TenantDeletionHalt` gains `contract-runs-past-end`, which an exhaustive
  `switch` over it has to handle.
- `@saasicat/spec` describes the two admin routes in `admin-api.openapi.yaml`.
- `@saasicat/ui-vue`: `TenantDetailPage` shows the section "Deletion",
  `SubscriberRecordPage` the section "Deletions"; the resources gain
  `tenants.deletion` and `subscribers.deletions`, and `useTenantDeletion`,
  `useSubscriberDeletions`, `useTenantDeletionWriters`, `useTenantKeep`,
  `tenantDeletionWording`, `tenantDeletionRecordWording` and `keepLineLabel`
  are new.
- `@saasicat/ui-vue-tenant`: `TenantAccessBanner` lists the lines under "Keep
  for your own records". `TenantPlanSectionI18n` gains `accessKeepHeading` and
  `accessKeepLine`, which a catalogue built whole adds.

Nothing to wire. See `docs/guides/wire-the-backend.md` and
`docs/guides/upgrade-to-1.0.md`.

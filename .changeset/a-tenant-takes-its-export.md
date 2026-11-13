---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant takes its own export before its data is deleted

**Breaking: wherever `tenantBilling` is on, the application no longer starts
without `tenantBilling.subscriptionEnds.export`**
(`subscription-ends.requires-export`). It is a `TenantDataExportPort` of the
application's: `export(tenantId)` answers everything the application keeps for
the tenant as one file, `{ content, mediaType, fileName }` — the whole file as a
`Uint8Array`, a media type in printable ASCII, and a file name. The option is
typed optional, so the compiler does not ask for it; the start does.
`TenantBillingModule` wired by hand refuses `subscriptionEnds` without it in the
same way.

Once the end of a tenant's subscription is recorded, its own administrator
(`TENANT_ADMIN`) downloads the file from `GET billing/export`, and still after
the deletion day while the data is there; anyone else of the tenant is refused
`403 TENANT_ADMIN_REQUIRED`. The operator is refused
`403 TENANT_EXPORT_NOT_FOR_OPERATOR` — a user holding `SUPER_ADMIN`, and one the
application's check let through with `actingAsOperator: true` — so that every
recorded download is the tenant's own; `mayExport` is `false` for them. The
platform asks the port on every download, for the session's tenant only. Before
an end is recorded the route refuses with `409 TENANT_EXPORT_NOT_OFFERED`; a
port that throws or answers anything but a file of at least one byte is refused
with `503 TENANT_EXPORT_FAILED`, and nothing is recorded or sent. A `HEAD` is
answered `405` with `Allow: GET` and asks and records nothing. One export of a
tenant is produced at a time within a process, since each is held in memory as a
whole: a second request meanwhile is refused with
`409 TENANT_EXPORT_IN_PROGRESS`. A suspension and a deletion under way refuse it
as they refuse every request. The file name is cleaned for the header.

Every download is recorded once the application has handed the file over and
before the file is sent — its moment, who took it by the user's id and as the
audit log tags an actor, and the file's size in bytes — and audited as
`TENANT_EXPORT_DOWNLOAD` where the audit log is wired; a download that cannot be
recorded sends no file. Adopt the `TenantExportDownload` model (fragment 31) and
run `1.0-subscription-ends-are-kept.postgres.sql`: it now also creates
`tenant_export_downloads`, and where it ran before it creates only what is
missing. Both shipped adapters provide the new `SubscriptionEndPort` methods
`recordExportDownload` and `listExportDownloadsFor`; a port of your own adds
them, and the persistence contract and `FakeSubscriptionEndRepository` cover
them.

`TenantAccessBanner` names, beside an ended subscription, the last day the
tenant can read and the day its data is deleted, to every user of the tenant —
once that day has come and nothing has deleted the data, as a deletion that is
due, which the tenant can still read until it happens — and offers its
administrator the export as a download that says why where it fails.
`GET billing/access` and `GET billing/account/access` answer each reason's
`readOnlyUntil`, `deletesOn` and `deletionDue` and the reader's `mayExport`;
`useTenantExport` in `@saasicat/ui-vue` downloads the file for a screen of your
own. `TenantDetailPage` names under "Access" the deletion day and every download
with its day and who took it, from the reasons' new `deletesOn` and
`exportDownloads`. Texts of your own for the tenant section gain
`accessReasonEndedDays`, `accessReasonEndedDeletionDue`, `accessExport` and
`accessExportFailed`. `TenantAccessService.viewOf` and `tenantAccessViewOf` take
`isTenantAdministrator` and `now`, and
`TenantAccessService.actsAsOperator(request)` answers whether the check let a
request through as the operator. Nothing is deleted on the day by this release.

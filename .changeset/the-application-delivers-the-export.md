---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue-tenant': minor
---

An application can deliver a tenant's export itself

`tenantBilling.subscriptionEnds.export` now takes, in place of a
`TenantDataExportPort`, the declaration `{ deliveredBy: 'application' }`: the
application delivers the tenant's full export from a download of its own — a
stream, where the file is too large to hold in memory — and the platform records
each download once it has gone out in full. One of the two is still required, in
the types and at start (`subscription-ends.requires-export`), and the refusal
names both. A declaration naming anybody but `'application'` is refused at start
too (`subscription-ends.export-delivered-by-the-application`), since an object
with `deliveredBy` is never a port. With the declaration the platform wires no
port and mounts no `GET billing/export`.

- `recordDelivered(request, { size, mediaType }, now?)` of
  `TenantExportDeliveryService`, from `@saasicat/nest/billing`, records a
  download the application delivered. Call it with the request the application
  served the file on, once the whole response has gone out. It reads the tenant
  and who took the export from that request's session by the rules of the
  platform's own route, writes the row in `tenant_export_downloads` beside the
  latest recorded end and `TENANT_EXPORT_DOWNLOAD` in the audit log, as a
  download the platform serves does, and answers the row as recorded. It
  refuses, recording nothing, with `405` for a `HEAD`, which carries no file
  whatever the stream counted, `409 TENANT_EXPORT_NOT_OFFERED` where no end of
  the tenant's subscription is recorded, `403 TENANT_EXPORT_NOT_FOR_OPERATOR`
  for the operator, `403 TENANT_ADMIN_REQUIRED` for a user who is not the
  tenant's administrator, and `503 TENANT_EXPORT_FAILED` for a size that is not
  a whole number of at least one byte, or a media type outside printable ASCII.
  It reads the end and writes the row through `RlsBypassPort` where one is
  bound, by the tenant the session names (`SC-SEC-020`). One download of a
  tenant at a time, and how long one may take, are the application's to bound on
  this path.
- The tenant's state, from `GET billing/access` and
  `GET billing/account/access`, gains `exportDeliveredBy`: `'platform'` or
  `'application'` where `mayExport` is `true`, and `null` otherwise.
  `TenantAccessViewOptions` takes it as an option, `'platform'` where it is left
  out, and `EndedSubscriptionSource` names it.
- `TenantAccessBanner` takes a `take-export` listener. Where the tenant's state
  says the application delivers the export, the button calls it instead of
  loading `GET billing/export`; the button is busy until what the listener
  returns settles, and a rejection is told beneath it as a failed download is.
  Where nothing listens, the banner writes an error to the console as soon as it
  offers the export, and pressing the button says the export did not arrive.
  Where the platform serves the export, the banner downloads it as before.
- `SC-PRIV-019` is superseded by `SC-PRIV-020`, and `SC-SEC-019` by
  `SC-SEC-020`.

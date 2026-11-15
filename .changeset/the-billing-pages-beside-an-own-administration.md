---
'@saasicat/core': minor
'@saasicat/nest': minor
---

The operator's billing pages beside an administration of your own

An application that serves its own routes for tenants, users, the audit log
and subscriptions can now turn the platform's administration on without them:
`adminResources: { includeController: false }` keeps every route of the
application's and still serves the operator's billing pages — the invoice
register and documents, the cancellation, the contracts, the subscriber's
record and account, the open items, the credits and the reconciliation
(`SC-ADM-057`). Before, such an application had to leave `adminResources` off,
because its generic routes collided with the application's, and the operator
had no billing pages.

It asks of the application no more than two lookups, the new
`AdminTenantLookupPort` from `@saasicat/core`: `getTenantDetail(slug)` and
`findTenantsByIds(ids)`. `AdminResourcesPort` extends it, so a full port serves
as well. Without either port and without `persistence.adminResources`, the
start is refused with a sentence that names both methods.

**Breaking** for code that names the options types:
`SaaSiCatAdminResourcesOptions` and `AdminResourcesModuleOptions` are now
unions on `includeController`, so an `interface … extends` either one becomes a
`type` with `&`. `AdminResourcesService.listTenants`, `listUsers`, `listAudit`
and `listSubscriptions` refuse a lookup-only port. Passing `adminResources:
true`, or an object without `includeController`, needs no change. See "The
billing pages beside an administration of your own" in the upgrade guide.

---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/ui-vue': minor
---

A suspension is the platform's own record

Suspending a tenant in the administration now records a `suspended` reason
among the reasons the platform keeps, and reactivating lifts that reason and no
other: a tenant whose invoice is overdue stays read-only. Nothing of the
application's is written any more — `AdminResourcesPort.setTenantActive` is
removed, and with it the subscription status a suspension set: suspending no
longer marks a tenant's subscriptions `PAST_DUE`, and reactivating no longer
sets them all `ACTIVE`, a cancelled one included.

The administration's tenant rows and detail carry the platform's state as
`access`, and their `isActive` says whether the tenant may act at all, so a
page that reads it keeps showing a suspension. The list's `ACTIVE`, `INACTIVE`
and `SUSPENDED` filters are answered from that state, as filters the adapter
applies before it cuts the list, so a suspended tenant is found however old.
Suspending a suspended tenant answers `TENANT_ALREADY_SUSPENDED`, reactivating
one that is not suspended `TENANT_NOT_SUSPENDED`. The pages offer reactivating
only for the platform's suspension (`tenantActionVisible`).

Breaking: remove `setTenantActive` from an `AdminResourcesPort` of your own and
let its `listTenants` apply the new `isActive`, `tenantIds` and
`excludeTenantIds` filters in its query, before its limit; ask
`TenantAccessService.assertAllowed` at sign-in instead of your own tenant flag,
and suspend again any tenant suspended before this release. `adminResources` now
needs `persistence.core.tenantAccessHolds` as `tenantBilling` does. The upgrade
guide has the steps.

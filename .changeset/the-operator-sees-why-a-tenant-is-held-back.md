---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

The operator sees why a tenant is held back

The tenant's detail answers `accessReasons` beside `access`: every reason the
tenant is held back for, the oldest first — its kind and the moment it began,
the operator's note on a suspension, an invoice unpaid on its due date by its
number and the subscriber whose record lists it. `TenantDetailPage` lists them
under "Access", the invoice linked to that record, and says so where nothing
holds the tenant back. Where invoices are not wired, an unpaid invoice is still
listed, without a number.

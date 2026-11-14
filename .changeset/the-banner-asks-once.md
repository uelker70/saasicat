---
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant's page asks its state once

`TenantAccessBanner`, through `useTenantAccessState`, now asks
`GET billing/access` alone, on mount and once a minute after. It used to ask
`GET billing/account/access` first and fall back to `GET billing/access` on a
403, 404 or 501, so every open page put a refused request into the logs each
minute: a 404 where the installation issues no invoices, a 403 for every user
without the billing permission.

Where invoices are issued, `GET billing/access` now tells a user holding the
billing permission what `GET billing/account/access` tells them: each overdue
reason's invoice number, `holdsBillingPermission: true`, and `mayPay` where a
payment gateway collects. Who holds the permission is decided by the same
`tenantBilling.billingPermissionGuards` that guard the invoice routes, or the
tenant's administrator where none are passed; a guard that returns `false` or
throws a 401 or 403 means the user does not hold it, and any other failure fails
the read. Every other user, and every user where no invoices are issued, is told
no number and cannot pay, and is not refused. Those guards are now asked from
`GET billing/access` too, for every user, once a minute, and must decide from
the request alone rather than from handler metadata.

`GET billing/account/access` still answers a holder of the permission the same,
and still refuses everybody else. A client of your own that reads it and falls
back to `GET billing/access` can read `GET billing/access` alone.

---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant's users read why it is held back

`TenantAccessBanner` shows every user of a tenant held back why, above the
application: the state in the words a refused request uses, and each reason
with the day it began in the installation. A user holding the billing
permission reads an unpaid invoice by its number and can pay it there while
the tenant is read-only; anybody else is told who can pay it. It shows nothing
while the tenant is open, and reads the state again every minute, so a hold
begun or lifted while a page is open shows without a reload.

It reads two new routes, `GET billing/access` for every user and
`GET billing/account/access` behind the billing permission
(`TenantAccessView`); `useTenantAccessState` reads them for a banner of your
own. Both carry the new access mark `reads-its-state` and are let through in
every state, suspended and being deleted included — your guard's `enforce`
reads the mark as the platform does. Texts of your own for the tenant section
gain the `accessReason…` keys and `accessAskBilling`.

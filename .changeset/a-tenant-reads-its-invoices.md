---
'@saasicat/core': minor
'@saasicat/nest': minor
---

A tenant reads its subscription's invoices and contract confirmations

The tenant's routes gain four, mounted where invoices are issued and behind the
tenant's authentication and the billing permission:
`GET /billing/invoices` — fifty a page, the newest first, `?after=` the last of
the page before —, `GET /billing/invoices/:id/document`,
`GET /billing/contracts` and `GET /billing/contracts/:id/confirmation`. They
list every invoice of the subscriber the session's tenant belongs to, an earlier
tenant's joined into it included (`SC-PRIC-097`), each with where it stands; a
document is the file archived when it was issued. Another subscriber's invoice
or contract is answered `404` like one that does not exist. Under row-level
security the reads run inside `RlsBypassPort`, by that subscriber's id alone
(`SC-SEC-018`). The types are `TenantInvoicePage` and
`TenantContractConfirmations` in `@saasicat/core`.

Breaking: `payments.billingPermissionGuards` moved to
`tenantBilling.billingPermissionGuards`, as the permission governs the whole
billing area and invoices are issued without a payment gateway. The start
refuses the old key, saying where it went.

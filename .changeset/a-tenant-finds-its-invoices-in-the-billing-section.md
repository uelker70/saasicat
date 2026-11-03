---
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant finds its subscription's invoices in the billing section

`TenantBillingSection` lists the invoices the operator issues the tenant under
"Invoices for your subscription", with the issuer beneath — each row its own
where more than one issued them (`SC-UI-022`). Each shows its number, issue
date, service period, due date, total and where it stands: open, overdue, open
in part, paid on a day, its payment reversed, to be refunded or refunded on a
day; a cancelled invoice links to its cancellation and its replacement, and each
of those back (`SC-UI-024`). A document is offered once it is archived, and
"Document follows" until then; the contract confirmations stand beside them.
Every day is the one the server names, written with your `formatDate`.

Breaking: `TenantBillingSection` now requires `formatDate` and
`formatCurrency`, as `TenantPlanSection` does. `useTenantInvoices` in
`@saasicat/ui-vue` is the composable behind it, for a page of your own.

---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant reads its account in the billing section

`GET /billing/account`, beside the invoices and behind the billing permission
like them, answers per currency what the subscriber's invoices still owe and of
that what is overdue, and beside it the credit to be refunded — never one set
off against the other (`SC-PRIC-049`). It is added up from the standings the
invoice list shows, by `tenantAccountOf` in `@saasicat/core`, so the two never
disagree; a charge on no invoice yet is not in it.

`TenantBillingSection` shows it at its top: "Open: …, of that overdue: …" and
"Credit: …, to be refunded", or "Nothing is open.", naming the currency on each
line where there is more than one. `useTenantAccount` in `@saasicat/ui-vue` is
the composable behind it. The sentences are catalogue keys (`accountTitle`,
`accountOwed`, `accountOwedOverdue`, `accountCredit`, `accountNothingOpen`,
`accountLoadFailed`, `accountInCurrency`).

`SC-PRIC-019` is withdrawn: `SC-PRIC-049` covers its ground, the billing
permission with it.

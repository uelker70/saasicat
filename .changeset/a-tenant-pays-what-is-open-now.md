---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant pays what is open now, and a payment method entered collects it

A user holding the billing permission pays every invoice still open at once
with the payment method in use, at `POST /billing/account/pay` — read-only
included, where it is one of the two writes left, beside replacing the payment
method. A card is charged now, and a tenant held back is let go once the
payment is there; a direct debit is announced and collected the lead time
after. A card charge planned for a later day gives way to it, a direct debit
already announced with the payment method in use keeps the day the subscriber
was told, one on its way is not started twice, and a payment method a payment
was taken back on collects nothing again. The answer, `TenantPaymentStarted`,
counts what was set going.

A payment method the subscriber confirms in the gateway's form now collects
what is open as each invoice says — from the day it named, or at once where
that day has passed —, an invoice issued while no payment method was in use
included, which nothing collected before. The quarter-hourly run takes up
what the confirmation does not reach: `InvoiceCollectionRepository.listDue`
now also answers an invoice issued without a payment method once its
subscriber has one in use and the invoice still owes something — an adapter
of your own follows that.

`TenantAccountCard` offers "Pay now" where something is open, says beside it
that a card opens the account again at once and a direct debit once it is
collected — on the day the installation's lead time names — and the bank
confirms it, and afterwards what was set going. The account answer gains
`directDebitCollectedOn`, that day; `useTenantAccount` gains it beside `payNow`,
`paying`, `started` and `payError`. The access check's mark for these routes is
`starts-payment`.

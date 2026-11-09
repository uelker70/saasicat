---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

The payment method card says when a new one collects

Before the subscriber replaces the payment method, `TenantPaymentMethodCard`
says that a new card is charged at once for what is due and a new direct debit
no earlier than the day the installation's lead time puts after today. A
direct debit entered after an invoice was issued can fall past its due date,
and the tenant is then read-only until it is paid; the card says so before the
choice is made.

`GET /billing/payment-method` answers `directDebitCollectedOn` beside
`paymentMethod`, and `useTenantPaymentMethod` carries it. The card takes an
optional `formatDate`; without one the day reads `YYYY-MM-DD`. Texts of your
own gain `paymentMethodReplaceWait` with `{date}`. `directDebitCollectedOnAt`
in `@saasicat/core` is the one place the day is worked out, for the account
and the payment method alike.

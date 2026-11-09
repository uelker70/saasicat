---
'@saasicat/core': minor
'@saasicat/nest': minor
---

An invoice unpaid on its due date makes the tenant read-only until it is paid

An invoice still open on its due date makes its subscriber's tenant read-only
from that day until it is paid, with no grace period: a card declined, a direct
debit refused or returned, a chargeback, a collection planned for a later day
or no payment method to collect it. A direct debit sent on the due date holds
nobody back while the bank has not answered; a collection started again after a
refusal keeps the tenant read-only until the payment is there. The
quarter-hourly invoice run records one `overdue` reason per invoice as its last
step, after the collection, and lifts each whose invoice no longer owes; the
payment that settles an invoice lifts its reason at once. Lifting it lifts no
other reason, so a suspended tenant stays suspended.
`OverdueInvoiceService.holdBackDue` is the step for an application with a
scheduler of its own.

A read-only tenant can still replace its payment method while one of its
subscriber's invoices is open: the platform's
`POST billing/payment-method/setup` is let through by the access check — the
application's guard included — and stays behind the billing permission. A
suspended tenant, and one being deleted, cannot.
`TenantAccessService.assertAllowed` takes `replacesPaymentMethod` for the same
exception without a request.

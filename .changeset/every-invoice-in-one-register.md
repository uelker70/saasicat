---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/ui-vue': minor
'@saasicat/cli': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

The administration lists every invoice of a span of months, with its sums

A new standard page, `invoices`, lists every invoice issued in the months
picked — the current month in the installation's time zone where none is, at
most twelve at a time — whichever subscriber and tenant it was for, by issue
date and then number, fifty to a page. Each row names what the invoice
corrects, the cancellation invoice that cancelled it, the subscriber with the
way into its record, its net, tax and gross, and whether its document is
archived or still awaited; an invoice that stands is cancelled from its row as
from the record. Beside the list stand the sums per month, currency, tax
treatment and rate, and over the whole span: 0 % exempt and 0 % under the
reverse charge are two sums, and a cancellation invoice counts with its own
sign in the month it was issued.

`GET admin/invoices` and `GET admin/invoice-totals` are new, under
`invoices.read`, and refuse months reversed or more than twelve with
`SUBSCRIPTION_INVOICE_REGISTER_RANGE_REVERSED` and
`SUBSCRIPTION_INVOICE_REGISTER_RANGE_TOO_LONG`. `SubscriptionInvoiceRepository`
gains `listIssued`, `listIssuedAmounts` and `findByNumber`, implemented by both
adapters and held by the persistence contract; a repository of your own adds
them.

`<app> invoices cancel` names the invoice by its number alone, so an invoice of
a tenant deleted since is cancelled too; `--tenant` stays and refuses an invoice
issued for another tenant with `INVOICE_TENANT_MISMATCH`.
`InvoiceCancellationService.invoiceIdNumbered(tenantId, number)` is
`invoiceNumbered(number)`. The texts of a tax treatment moved from
`subscribers.payments.cancelDialog.taxTreatment` to
`subscribers.payments.taxTreatment`.

---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/cli': minor
'@saasicat/spec': minor
---

The tenant page cancels an invoice, and a cancellation is held to the preview
the operator confirmed

Each invoice on the tenant page says what it corrects and which cancellation
invoice cancelled it — `AdminTenantPayments` carries `correction` and
`cancelledBy` for each. One that stands offers the cancellation in two steps:
the reason, an address to deliver to and the subscriber's details the
replacement names corrected, then the server's preview, confirmed with the
second factor.

A preview answers a `digest` of everything the cancellation would write but
the moment it issues the two invoices, and a cancellation may carry it back as
`previewDigest`; where what it would write differs — a payment came in, the
subscriber's legal identity was corrected meanwhile —, it is refused with
`SUBSCRIPTION_INVOICE_CANCELLATION_PREVIEW_CHANGED` and the new preview, and
nothing is written. `InvoiceCancellationRequest` moves from `@saasicat/nest` to
`@saasicat/core`. After `--apply`, `<app> invoices cancel` says what was taken
over as paid and what was credited.

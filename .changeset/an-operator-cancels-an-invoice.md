---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/cli': minor
'@saasicat/spec': minor
---

An operator cancels an issued invoice, from the administration or the command
line

`POST admin/tenants/:slug/invoices/:invoiceId/cancellation/preview` answers
what cancelling the invoice would write and writes nothing;
`…/cancellation` writes it, with the second factor, and records
`SUBSCRIPTION_INVOICE_CANCELLED` in the audit log with the reason, which
details were corrected and whether an address to deliver to was given. The
manifest announces both as `invoices.cancel`, served where the invoices'
documents are. `<app> invoices cancel --tenant <slug> --invoice <number>
--reason "…"` previews the same, and cancels with `--apply`, the second factor
and, against production, a confirmation.

The reason is one line of at most 500 characters, refused otherwise with
`SUBSCRIPTION_INVOICE_CANCELLATION_REASON_INVALID`; corrections are settled as
the subscriber's record holds each detail; an address to deliver to is trimmed
and refused with `SUBSCRIPTION_INVOICE_DELIVERY_ADDRESS_INVALID` where it is no
email address. The cancellation invoice and its replacement are sent to that
address where one was given, and the replacement's collection notices too where
the subscriber's record holds no invoice email; nothing is written back onto
the record.

`SC-PRIC-091`, `SC-PRIC-092` and `SC-PRIC-093` supersede `SC-PRIC-025`,
`SC-PRIC-026` and `SC-PRIC-077`: a replacement names the legal entity and the
subscriber of the invoice it replaces, and carries the issuer's address,
contact details and footer as `config/saas.yaml` names them on its own issue
date, as it already did. `InvoiceCancellationPlan` names `reason` and
`deliverTo`.

---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/tax-de': minor
---

An invoice is issued from the charge journal

Every quarter of an hour, `SubscriptionInvoiceService.issueDue` issues one
invoice for the charges booked together under a contract — the charges a
billing period opens with, or one that arises later in the period. The number
is `<prefix>-<year>-<sequence>`, such as `AHP-2026-000123`, drawn in the
transaction that writes the invoice, so a refused or failed invoice leaves no
gap and two at the same moment take two numbers one after the other
(`SC-PRIC-072`, which supersedes `SC-PRIC-023`). An invoice copies the
subscriber as its record stands and the issuer of its contract, with the
corrections the operator declared since; the tax adapter decides its treatment
for the subscriber as it stands, computes its tax once per rate, and checks its
content before the number is drawn. Its days count in the installation's time
zone, and it falls due `paymentTermDays` after its issue date. A period whose
charges are all zero issues none. An invoice that cannot be issued yet waits,
and the audit log records why once per process as `SUBSCRIPTION_INVOICE_HELD`.

Invoicing ships switched off. Do not switch it on for real customers before
`1.0.0-rc.28`: an issued invoice is never edited, and the cancellation invoice
that corrects one arrives there. The document, the archive and the mail come in
a later release. One installation is the range of exactly one issuer; a second
application issuing for the same issuer is not supported.

To adopt it, see "An invoice is issued from the charge journal" in
`docs/guides/upgrade-to-1.0.md`: the optional fragment
`20-subscription-invoice.prisma`, the migration
`1.0-an-invoice-is-issued.postgres.sql`, the `invoicing` block in
`config/saas.yaml` with `numberPrefix` and `paymentTermDays`, and
`tenantBilling.chargeJournal.invoices`. The start refuses the wiring without the
block and, where tenant billing is configured, the block without the wiring;
either without a tax adapter or an issuer; and a prefix other than the one the
issued invoices carry.

Breaking for a tax adapter of your own: `TaxAdapter` gains `invoiceTax` and
`invoiceContentGaps`, which `@saasicat/tax-de` implements. A persistence
contract harness wires `subscriptionInvoiceRepository` or declares
`gaps: ['subscriptionInvoices']`, and empties `subscription_invoice_numbers`
between scenarios.

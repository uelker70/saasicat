---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/tax-de': minor
---

An invoice's document is archived, mailed and downloaded as it was issued

The quarter-hourly run now renders each issued invoice into the file its tax law
requires, has the tax adapter check that file, records the file's SHA-256 with
the invoice, archives it, and mails it to the invoice email on the subscriber's
record with the file attached (`SC-PRIC-042`, `SC-AUD-019`, `SC-PRIC-047`).
Until the archive confirms, an invoice is neither mailed nor offered, and an
interrupted attempt is repeated under the same number (`SC-PRIC-033`): a file
the archive already holds is the one it was issued as, and where it holds none,
a rendering from a renderer updated in between takes the place of the recorded
one, with both checksums in the audit log (`SC-AUD-019`, which supersedes
`SC-AUD-015`). A run claims an invoice's mail before it sends it, so of several
instances one does. The operator downloads the archived file at
`GET admin/invoices/:id/document`, announced as `invoices.read`, checked against
the recorded checksum and never rendered again (`SC-AUD-014`).

`tenantBilling.chargeJournal.invoices` now requires `renderer` (an
`InvoiceRenderer` of the application's), `archive` (such as
`persistence.entitlement.subscriptionInvoiceArchive`) and `mail` (an
`InvoiceMailPort` of the application's), and the start refuses the wiring
without any of them. The shipped archive is the database: the new fragment
`22-subscription-invoice-archive.prisma` and `SubscriptionInvoiceDocument` in
`20-subscription-invoice.prisma`, created by
`1.0-an-invoice-document-is-archived.postgres.sql`, whose triggers refuse every
update, delete and truncate of an archived file. Run that migration after
`db push`; the start refuses invoices beside an archive whose triggers are
missing or disabled.

Breaking for a tax adapter of your own: `TaxAdapter` gains
`invoiceDocumentGaps(document, invoice)`. `@saasicat/tax-de` implements it as
a check of ZUGFeRD in the EN 16931 profile: a PDF/A-3 carrying `factur-x.xml`
whose figures are the invoice's. A persistence harness gains `invoiceArchive`,
or declares `gaps: ['invoiceArchive']`.

See "An invoice is issued from the charge journal" in
`docs/guides/upgrade-to-1.0.md`.

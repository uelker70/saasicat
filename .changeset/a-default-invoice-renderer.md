---
'@saasicat/invoice-zugferd': minor
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/tax-de': minor
---

A default invoice renderer, and the footer an invoice carries

The new package `@saasicat/invoice-zugferd` renders an issued invoice into
ZUGFeRD in the EN 16931 profile: a PDF/A-3 with embedded fonts that a person
reads, labelled in German with English beside it, carrying the CII XML a program
reads. Pass `zugferdInvoiceRenderer()` as
`tenantBilling.chargeJournal.invoices.renderer`. It renders the same invoice
into the same bytes every time, ships Roboto under the Apache License 2.0, cut
down to Latin, Greek and Cyrillic, and takes a font of the application's own as
`fonts: { regular, bold }`. CI checks its output for every treatment the German
adapter decides with Mustang, which runs veraPDF for PDF/A-3b and the EN 16931
and Factur-X schematron (`SC-PRIC-078`).

`config/saas.yaml` takes up to six lines under `invoicing.footer`: what a
business letter of the issuer states beyond the invoice's own content, such as
the register court and number, the managing directors and a bank account. An
invoice copies them on its issue date, and one that names the contract's copy
of another entity carries none (`SC-PRIC-077`). `SubscriptionInvoiceRecord`
gains `footer`, stored in a new column of `subscription_invoices`, which
`1.0-an-invoice-is-issued.postgres.sql` adds where an earlier run of it created
the table.

`@saasicat/tax-de` checks a file outside the scope of VAT as EN 16931 asks: it
names no VAT identification number and states no rate.

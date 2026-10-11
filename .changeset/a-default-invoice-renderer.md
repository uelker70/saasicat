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

`@saasicat/tax-de` now compares the subscriber's VAT identification number, each
line's rate and every VAT category as well: a VAT identification number the XML
names for the subscriber is the one the invoice records, and under the reverse
charge it has to name it; every line states, in exactly one VAT breakdown, the
rate the invoice records; every breakdown names the category EN 16931 gives the
treatment; and neither party names more than one VAT identification number.
Outside the scope of VAT the XML names neither party's and states no rate, in
the breakdown or on a line. A renderer of an application's own that wrote
otherwise has its file refused, and the invoice waits under its number. It also
refuses embedded XML that holds a character XML 1.0 forbids, which its parser
had read past, and reads an element the format gives once but the XML states
twice as missing. A name the invoice records with such a character is compared
as the XML has to write it, with `?` in its place.

`@saasicat/core` exports what the renderer, the adapter and the API read alike:
`vatCategoryOf(kind)`, and `holdsOnlyXmlCharacters` and `withXmlCharactersOnly`
for the characters XML 1.0 can hold. `@saasicat/nest` refuses a subscriber's
detail that holds one it cannot, such as a control character pasted with a name,
with `SUBSCRIBER_DETAIL_INVALID` naming the field.

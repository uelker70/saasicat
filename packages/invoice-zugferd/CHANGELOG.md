# @saasicat/invoice-zugferd

## 1.0.0-rc.27

### Minor Changes

- 9c9f624: An invoice says how it is paid

    An invoice now records, when it is issued, the subscriber's payment method in
    use that it is collected with (`SubscriptionInvoiceRecord.payment`), copied as
    it stood then. An invoice collected by SEPA direct debit announces the amount,
    the day it is collected from and the mandate reference, as SEPA asks of the
    notice before a debit (`SC-PRIC-028`), and falls due on that day
    (`SC-PRIC-046`): the issue date plus `invoicing.directDebitLeadDays` in
    `config/saas.yaml`, fourteen calendar days unless set. Set it to what the
    mandate your subscribers accepted provides for; the one Stripe shows provides
    for two days. Any other invoice falls due the payment term after its issue date,
    as before. Nothing is collected yet.

    An invoice that asks for nothing and one of a subscriber without a payment
    method record none and are not collected. One of a direct debit whose gateway
    never named its mandate reference cannot be announced: it waits, draws no
    number, and is issued with its announcement once the payment method is
    replaced. The audit log records it as `SUBSCRIPTION_INVOICE_HELD` with the new
    code `SUBSCRIPTION_INVOICE_MANDATE_MISSING`.

    `zugferdInvoiceRenderer()` states it on the page, in German and English, and in
    the XML: the payment means (`59` for a direct debit, `48` for a card named by
    its last four digits), the payment terms' text and the mandate reference.

    Run `1.0-an-invoice-says-how-it-is-paid.postgres.sql` once, before `db push`:
    it adds the nullable `payment` and `collectionDate` to `subscription_invoices`,
    which fragment 20 declares. An invoice issued before records no payment method
    and stays due on the day it states. Where `config/saas.yaml` names `payments`,
    the start refuses invoices that cannot read the payment methods, as with
    `PaymentsModule` wired other than globally.

### Patch Changes

- Updated dependencies [5396ab6]
- Updated dependencies [3ab58af]
- Updated dependencies [3cca4f4]
- Updated dependencies [f453f75]
- Updated dependencies [9c9f624]
- Updated dependencies [e183f06]
    - @saasicat/core@1.0.0-rc.27

## 1.0.0-rc.26

### Minor Changes

- c4ad49a: A default invoice renderer, and the footer an invoice carries

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
    `vatCategoryOf(kind)`; `holdsOnlyXmlCharacters`, for the characters XML 1.0 can
    hold; and `asXmlReadsIt`, a text as an e-invoice's XML states it and any parser
    reads it back, with `?` for a character XML cannot hold and a carriage return as
    a line feed. `@saasicat/nest` refuses a subscriber's detail that holds a
    character XML cannot hold, such as a control character pasted with a name, or a
    tab or a line break inside it, with `SUBSCRIBER_DETAIL_INVALID` naming the
    field; one at either end is trimmed as before.

### Patch Changes

- Updated dependencies [c4ad49a]
- Updated dependencies [5f9d90b]
- Updated dependencies [dd102b5]
- Updated dependencies [917b4dc]
    - @saasicat/core@1.0.0-rc.26

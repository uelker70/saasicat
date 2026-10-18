# @saasicat/tax-de

## 1.0.0-rc.27

### Patch Changes

- Updated dependencies [5396ab6]
- Updated dependencies [3ab58af]
- Updated dependencies [3cca4f4]
- Updated dependencies [20c3991]
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

- dd102b5: An invoice's document is archived, mailed and downloaded as it was issued

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

- 917b4dc: An invoice is issued from the charge journal

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
    that corrects one arrives there. One installation is the range of exactly one
    issuer; a second application issuing for the same issuer is not supported.

    To adopt it, see "An invoice is issued from the charge journal" in
    `docs/guides/upgrade-to-1.0.md`: the optional fragment
    `20-subscription-invoice.prisma`, the migration
    `1.0-an-invoice-is-issued.postgres.sql`, the `invoicing` block in
    `config/saas.yaml` with `numberPrefix` and `paymentTermDays`, and
    `tenantBilling.chargeJournal.invoices`. The start refuses the wiring without the
    block and, where tenant billing is configured, the block without the wiring;
    either without a tax adapter, an issuer or the record of the applied settings,
    which holds the issuer to one legal entity; and a prefix other than the one the
    issued invoices carry. `SaaSiCatModule` now registers `SettingsModule`
    globally, as it does `AdminModule`, so tenant billing reaches the record.

    Breaking for a tax adapter of your own: `TaxAdapter` gains `invoiceTax` and
    `invoiceContentGaps`, which `@saasicat/tax-de` implements. A persistence
    contract harness wires `subscriptionInvoiceRepository` or declares
    `gaps: ['subscriptionInvoices']`, and empties `subscription_invoice_numbers`
    between scenarios.

### Patch Changes

- Updated dependencies [c4ad49a]
- Updated dependencies [5f9d90b]
- Updated dependencies [dd102b5]
- Updated dependencies [917b4dc]
    - @saasicat/core@1.0.0-rc.26

## 1.0.0-rc.25

### Minor Changes

- 3258251: A tax adapter decides the rate of every contract

    `config/saas.yaml` can name a tax adapter instead of one `vatRate`
    (`SC-PRIC-066` supersedes `SC-PRIC-009`), and every contract is then concluded
    at the rate it decides for its subscriber (`SC-PRIC-065` supersedes
    `SC-PRIC-008`). Without `tax` nothing changes.

    - **Naming and binding it.** The file names the adapter, its options and the
      installation's `timeZone`; the application binds the adapter's factory,
      `SaaSiCatModule.forRoot({ tax: { adapter: germanTaxAdapterFactory() } })`.
      `vatRate` is no longer required by the schema; the loader refuses `vatRate`
      beside `tax`, a file naming neither, and a time zone the runtime does not
      know, and `tax` requires `timeZone`; the start refuses the same for a
      catalogue handed over in code, which never meets the loader. Three start rules
      guard the binding: `tax.adapter-bound-as-the-file-names`,
      `tax.rate-has-one-source` (no `catalog.publicMarketingCatalog.vatRate` beside
      an adapter) and `catalog.public-catalogue-names-a-rate` (without an adapter,
      the public catalogue still needs it).
    - **The contract.** An offer is priced at the rate for a subscriber in the
      issuer's country; concluding it restates its money at the rate decided for
      the subscriber, from the billing address, the business flag and a validated
      VAT number, for the contract's first period. The contract records the
      treatment beside the rate (`SC-PRIC-067` supersedes `SC-PRIC-016`). A
      successor — a change, a refresh, a frozen version, a retirement's move — is
      decided again before the contract in force ends, so a refusal leaves it
      running. Where the adapter supports no treatment, there is no contract:
      `TAX_TREATMENT_NOT_SUPPORTED` (422) with the adapter's sentence, and a
      retirement's move records the failure `tax-not-supported` and tries again.
      A contract handed to `SubscriptionContractService.create` at another rate is
      refused with `SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_DECIDED`, naming the field
      and the decided rate.
    - **Asked before a change, over the contract it ends in.**
      `ContractFreezePort.assertPartyFor(tenantId, intended)` and
      `SubscriptionContractService.assertPartyFor(tenantId, intended, tx?)` take the
      contract the change ends in — `IntendedContract` from
      `@saasicat/nest/subscription-contract`: `effectiveFrom`, `cycle`, `endsAt` —
      and, with an adapter, decide over its first period: a plan change from today
      or from the date it is scheduled for, in the rhythm asked for; a booking, a
      version switch, a retirement's move or switch from when it freezes; `null`
      where the change ends in no contract now — a plan change, a version switch or
      a retirement's move in a trial — asks for the party alone. A port of your own
      takes the second argument, and code that calls it passes it. An activation
      through onboarding outside a trial asks too, before it writes.
    - **A promo code with a fixed amount** comes off what the subscriber pays: at
      19 % its net share, at 0 % the whole amount. Every net price and promotion
      stays as offered (`SC-MKT-027` supersedes `SC-MKT-023`). With an adapter, the
      zero-invoice rule measures the amount against the lowest net price instead
      of the gross (`SC-PROMO-029` supersedes `SC-PROMO-008`), and
      `PROMO_WOULD_PRODUCE_ZERO_INVOICE` names it as `lowestApplicablePlanNet`. The
      preview and the redemption measure against the net too, so a code stored at
      or above a plan's net price is refused there with
      `WOULD_PRODUCE_ZERO_INVOICE`: review the codes before naming the adapter.
    - **A code and a promotion together leave something to pay** (`SC-PROMO-030`),
      with an adapter or without: an offer whose code takes all that the plan's
      promotion leaves is refused when it is priced and when it is concluded, with
      `CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED` and the reason
      `WOULD_PRODUCE_ZERO_INVOICE`, unless the code allows an invoice of zero. The
      promo preview's `discount` carries `allowZeroInvoice`.
    - **What is shown.** The pricing page, the configurator, the admin manifest
      and the offer show the adapter's rate for a subscriber in the issuer's
      country. `PublicMarketingCatalogResponse` carries `vatRateShownFor`: that
      country, or `null` where the file's one rate applies to everybody.
      `MarketingCatalogProvider.getVatRate` and `publicMarketingCatalog.vatRate`
      become optional: required without an adapter, refused beside one — by the
      start, and by the page where a `CatalogModule` is mounted on its own.
    - **For code of your own,** `TAX_TREATMENTS_TOKEN` from
      `@saasicat/nest/billing` resolves `TaxTreatments`, the one source of the
      shown and the decided rate.
    - **In `@saasicat/core`:** `TaxAdapterFactory`, `PlanCatalogTax`,
      `TAX_ERROR_CODES` and the two codes with their English and German texts.
    - **In `@saasicat/tax-de`:** `germanTaxAdapterFactory(codeOptions)`. The file
      may give `smallBusiness` and nothing else; `fetch`, `viesTimeoutMs` and `now`
      go to the factory.
    - **Settings in the database** (`SC-CFG-037` supersedes `SC-CFG-034`): an
      installation whose plans live in the database reads `tax` and `timeZone`
      from the file too.

    The upgrade guide has the steps for an existing installation.

- 808cd9f: The German tax adapter, `@saasicat/tax-de`

    A new package: the tax adapter for an issuer in Germany, behind the
    `TaxAdapter` port (ADR 0013). A template, not tax advice; the operator stays
    responsible for the tax it charges.

    - **What it decides** (`SC-PRIC-064`, which supersedes `SC-PRIC-044`): a
      subscriber in Germany at the German standard rate in force on the last day
      of the period, or without VAT where the issuer declares the small business
      exemption (`smallBusiness`, reaching subscribers in Germany only); a
      business elsewhere in the European Union with a validated VAT number under
      the reverse charge, where the issuer has a VAT number of its own; a business
      outside the Union as not taxable in Germany. Each note is German with
      English beside it, except the small business note, which stays German.
      Every other case is answered as not supported, with a sentence saying why,
      among them a VAT number of another state than the billing address.
    - **How it checks a VAT number**: through VIES, naming the issuer's number as
      the requester, and recording every text field of the answer. A number VIES
      cannot read is a completed check that found it invalid; an error, a timeout
      (`viesTimeoutMs`, ten seconds by default) or an unreadable answer is a check
      that did not complete, never a valid one.
    - **`TaxDecisionRequest` carries `timeZone`** in `@saasicat/core`: the
      installation's time zone, in which the days of the period count
      (`SC-PRIC-045`). `period.until` is documented as the first moment after the
      period.

    Nothing asks the adapter yet. A new package in the fixed group needs its
    manual first publish before the release that contains it.

### Patch Changes

- Updated dependencies [5f7a41b]
- Updated dependencies [5a4e6ca]
- Updated dependencies [d34e3e5]
- Updated dependencies [b4a961d]
- Updated dependencies [3258251]
- Updated dependencies [5776198]
- Updated dependencies [8fe675c]
- Updated dependencies [8683c32]
- Updated dependencies [cf12963]
- Updated dependencies [808cd9f]
- Updated dependencies [3496864]
    - @saasicat/core@1.0.0-rc.25

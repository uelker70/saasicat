# @saasicat/invoice-zugferd

## 1.0.0-rc.29

### Patch Changes

- Updated dependencies [42bcd7e]
- Updated dependencies [22a1ee7]
- Updated dependencies [c5e92a8]
- Updated dependencies [307168c]
- Updated dependencies [3cec45b]
- Updated dependencies [ae442f2]
- Updated dependencies [3853724]
- Updated dependencies [7ee72d2]
    - @saasicat/core@1.0.0-rc.29

## 1.0.0-rc.28

### Minor Changes

- bea18a3: A cancellation corrects what was not owed, line by line

    `InvoiceCancellationService` takes `lines`, the lines of the cancelled
    invoice that are not owed or owed at a lower amount. Each moves by a
    counter-entry written in the cancellation's transaction, and each discount
    that reduced it in the share it fell: a held add-on price and a booking's
    feature withdrawal reduction with that booking, every other discount with the
    plan, to the cent. The replacement carries what is still owed, a
    counter-entry's line after the line it corrects; where nothing is owed any
    more there is no replacement and everything paid becomes a credit, and a
    replacement that would ask for less than nothing is refused. Five refusal
    codes say what a line may not be (`SUBSCRIPTION_INVOICE_LINE_UNKNOWN`,
    `…_LINE_NAMED_TWICE`, `…_LINE_NOT_CORRECTABLE`, `…_LINE_OWED_INVALID`,
    `…_CORRECTION_LEAVES_A_CREDIT`). A correction now moves its charge towards
    nothing, so a discount's counter-entry gives back.

    Invoice lines gain `correctsPosition`, the line of the same invoice a
    counter-entry's line corrects, with its foreign key and the check
    `subscription_invoice_lines_correction_names_its_line`, both in
    `1.0-an-invoice-is-cancelled.postgres.sql` and `constraints.postgres.sql`.
    `zugferdInvoiceRenderer()` names it on the line ("Korrektur zu Pos. 2").
    `SC-PRIC-095` supersedes `SC-PRIC-091`, `SC-PRIC-096` supersedes
    `SC-PRIC-022`.

- c9f2d68: A cancellation invoice and its replacement are rendered as what they are

    `SubscriptionInvoiceRecord` gains `correction`: on a cancellation invoice or a
    replacement, the invoice it corrects — its id, number and issue date —,
    whether it cancels or replaces it, and the reason given. Each line gains
    `correctedPosition`, the line it cancels or replaces. Both are `null` on an
    invoice issued for the charge journal's charges, which every stored invoice is
    until cancelling one arrives; `toSubscriptionInvoiceRecord` sets them.

    `zugferdInvoiceRenderer()` titles a cancellation "Stornorechnung", never
    "Gutschrift", states the cancelled amounts reversed on its page with nothing to
    pay, and writes its XML as a credit note (type `381`) stating them as the
    cancelled invoice did; a replacement is an invoice. Both name the invoice they
    correct by number and issue date (BT-25, BT-26) and the reason, and each line
    names the line it stands for (BT-127) (`SC-PRIC-089`). CI validates both with
    Mustang, beside a cancellation under the reverse charge.

    `@saasicat/tax-de`'s document check reads a cancellation as a credit note and
    refuses one whose type, figures, due date or reference to the corrected
    invoice are not what the invoice records, and an invoice that names one.

- 4c9616d: Every contract is confirmed to its subscriber

    A contract written from this release on gives its subscriber a confirmation
    to keep (`SC-AUD-016`): rendered from the contract, archived write-once like
    an invoice's document, and mailed to the invoice email with the terms of the
    version the contract records. It states the whole contract in force and names
    the contract and the day it was written. A contract written before is not
    confirmed, and one whose parties a migration copied, or whose terms the
    archive does not hold, waits and is recorded in the audit log.

    Breaking for an installation that issues invoices: invoicing no longer starts
    without the confirmations. Pass `chargeJournal.invoices.confirmations` with a
    `renderer` — `contractConfirmationRenderer()` from `@saasicat/invoice-zugferd`
    is the default — and `InvoiceMailPort` gains
    `deliverConfirmation({ contract, to, documents })`. `SaaSiCatModule` takes the
    record and the archive from the persistence bundle
    (`entitlement.contractConfirmationRepository` and
    `entitlement.contractConfirmationArchive`, both adapters); the start refuses
    one whose triggers are missing or disabled.

    Fragment 26 adds `ContractConfirmation` and `ContractConfirmationArchive`, and
    fragment 08 gives `SubscriptionContract` the column `confirmationDue`, false by
    default so `db push` leaves the contracts already there unconfirmed; both
    adapters write it true on every contract they create. Run
    `1.0-a-contract-confirmation-is-archived.postgres.sql` after `db push`, which
    adds the archive's triggers. `ContractConfirmationService` runs in the
    quarter-hourly invoice run, and the operator downloads a confirmation at
    `GET admin/contracts/:id/confirmation`. The persistence contract gains the
    `contractConfirmations` and `contractConfirmationArchive` parts and the seed
    `markContractWrittenBeforeConfirmations`.

- 5c1b1ff: An issued invoice is corrected by a cancellation invoice and its replacement

    `InvoiceCancellationService` cancels an issued invoice in one transaction
    (`SC-PRIC-025`): a cancellation invoice that states it reversed and asks for
    nothing, a replacement for its charges under a new number — its tax decided
    again for the parties it names, its payment term from its own issue date, the
    subscriber with the operator's corrections and the corrections of its legal
    identity since —, and what was paid for it moved onto the replacement, each
    payment's share, the oldest first, the rest a credit for the operator to
    refund. `preview` takes the same steps and writes nothing. A cancellation is
    refused for an invoice cancelled already, a cancellation invoice, one whose
    document is not archived, one that states a credit, and a subscriber reached by
    no address. The operator's route and command follow.

    An invoice and the invoices that correct it are one chain, and whatever changes
    what an invoice of a chain owes or how it is collected — a payment, a reversal,
    a cancellation, a collection attempt — takes the chain's turn (`SC-PRIC-036`).
    A payment confirmed after a cancellation settles the replacement; no invoice of
    a chain is collected while an attempt for one of them is unresolved, nor with a
    payment method one of its payments was reversed on; a reversal of a payment
    that moved opens the replacement, and the subscriber is told about it once no
    attempt of the chain is on its way. An attempt is for what the invoice still
    owes, read by the store in the chain's turn rather than its total:
    `NewInvoiceCollection` and `PlannedInvoiceCollection` no longer carry `amount`.

    Run `sql/1.0-an-invoice-is-cancelled.postgres.sql` once before `db push`, after
    the invoice and payment migrations: it gives every invoice a chain of its own
    and does nothing on a second run. The start requires
    `contractFreeze.transactionRunner`, which `SaaSiCatModule` passes. A store of
    your own implements `holdChain`, `issueCancellation`, `findCancellation`,
    `findCancellationById`, `sharesOf` and `moveShares`;
    `ReversalWithdrawal.credit` is `credits`, and `withdrawalParts` takes a list.

    A cover a reversed payment's credit gave another reversal is lifted as a
    withdrawal of the covered payment would go without that credit, as everything
    stands then (`SC-PRIC-090`, superseding `SC-PRIC-088`): its credits first, a
    cancellation's share among them, then the other open credits for its invoices,
    then what it still settles of them, and a case for the rest. So a cover lifted
    after a cancellation opens the replacement by no more than its total, and two
    reversals end alike in either order where a third payment left a credit as
    well. `LiftedCover` names `credits`, `covering`, `invoices`, `unmatched` and
    `case` where it named one `invoiceId`.

    A reversal records what of its give-backs covered its cases
    (`reinstatedToCases`). A case opened after a give-back — the reversal grew, or
    a cover was lifted — was counted as covered by it, closed as given back while
    no money came back for it, and what came back afterwards settled an invoice
    instead. The migration gives each reversal so far what that count was.

    `zugferdInvoiceRenderer()` states what a replacement took over as paid, on its
    page and as BT-113, and the amount due less it, and announces a direct debit of
    the rest alone; `@saasicat/tax-de`'s check refuses
    a document whose prepaid amount or amount due is not what the invoice records.
    The tenant page names a credit a cancellation left by the cancelled invoice.

### Patch Changes

- Updated dependencies [bea18a3]
- Updated dependencies [c9f2d68]
- Updated dependencies [4c9616d]
- Updated dependencies [64d7503]
- Updated dependencies [a2578d7]
- Updated dependencies [f8a9e97]
- Updated dependencies [254e643]
- Updated dependencies [5c1b1ff]
- Updated dependencies [b239fdd]
- Updated dependencies [17ceb59]
- Updated dependencies [d5fdbe8]
- Updated dependencies [d0892a6]
- Updated dependencies [9a5f892]
- Updated dependencies [f38362e]
- Updated dependencies [ba9ad8f]
    - @saasicat/core@1.0.0-rc.28

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

### Patch Changes

- Updated dependencies [c4ad49a]
- Updated dependencies [5f9d90b]
- Updated dependencies [dd102b5]
- Updated dependencies [917b4dc]
    - @saasicat/core@1.0.0-rc.26

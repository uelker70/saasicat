---
doc_title: The invoicing procedure
related:
    - ../guides/wire-the-backend.md
    - adr/0012-the-subscriber-owns-the-commercial-record.md
    - adr/0013-tax-law-is-an-adapter.md
---

# The invoicing procedure

German bookkeeping rules (GoBD) ask whoever issues invoices to describe how they come about, in a
procedure documentation (_Verfahrensdokumentation_): how an invoice is produced, numbered,
corrected, archived, accessed and kept, so that an auditor can follow each one from its cause to its
copy in the archive (_Nachvollziehbarkeit_) and see that nothing was changed after it was issued
(_Unveränderbarkeit_). An installation of SaaSiCat that issues invoices from its charge journal has
such a procedure, most of it performed by SaaSiCat itself (`SC-ADM-025`).

This page describes each of the six steps as SaaSiCat performs it, and names what the installation
decides in it — a setting in `config/saas.yaml`, an adapter, a port the application wires — so that
the operator's own documentation states only what is its own. The identifiers in brackets are the
requirements each statement rests on, in the [requirements catalogue](../requirements.md), where the
tests that hold each one are listed. How to wire each part is in
[Invoices](../guides/wire-the-backend.md#invoices) in the backend guide.

## 1. Produced

**What SaaSiCat does.** An invoice is drawn up from the charges of the subscriber's charge journal,
which a contract gives rise to: one invoice for the charges a billing period opens with, and one of
its own for a charge that arises later in the period, such as an add-on booked mid-period. Every
charge is invoiced once (`SC-PRIC-096`), and a billing period whose charges are all zero issues no
invoice (`SC-PRIC-048`). Each line names the charge and the contract line it came from
(`SC-AUD-013`).

An invoice is put together from what holds on its issue date: the subscriber as its record stands,
with its customer number, the issuer, and the footer lines of the issuer's business letter
(`SC-PRIC-092`, `SC-PRIC-093`). The tax adapter decides the tax treatment for the subscriber's origin
on that day, and the invoice records the treatment, the rate and the adapter's name and version
beside the tax it computes once per rate (`SC-PRIC-037`, `SC-PRIC-038`, `SC-PRIC-041`). Its days —
the issue date, each line's period, the due date — are days in the installation's time zone
(`SC-PRIC-045`, `SC-PRIC-046`). An invoice collected by SEPA direct debit announces the amount, the
day it is collected and the mandate reference (`SC-PRIC-028`).

Before a number is drawn, the tax adapter checks the invoice's content against what its law
requires (`SC-PRIC-027`). An invoice that cannot be issued yet — a subscriber whose billing address
has gaps (`SC-PRIC-032`), content the adapter finds missing — draws no number and waits; the audit
log records it as `SUBSCRIPTION_INVOICE_HELD` with what held it, and the next run issues it once
that is put right. The runs go every quarter of an hour, by the actor
`job:platform:subscription-invoices`.

**What your installation decides.**

- the tax adapter and what you declare to it — `tax.adapter`, `tax.options` — and with it the law
  the content, the treatment and the document follow ([ADR 0013](adr/0013-tax-law-is-an-adapter.md));
- the issuer: `issuer.legalName`, `issuer.addressLine1`, `issuer.addressLine2`,
  `issuer.postalCode`, `issuer.city`, `issuer.country`, `issuer.vatId`, `issuer.taxNumber`;
- the footer lines your business letter has to state: `invoicing.footer`;
- the time zone the days count in: `timeZone`;
- the payment term, `invoicing.paymentTermDays`, and for a direct debit the lead time before it is
  collected, `invoicing.directDebitLeadDays`;
- the terms a contract is concluded under, which its confirmation names: `terms.file`,
  `terms.version`;
- where the subscribers' charges and invoices are kept: the `SubscriptionInvoiceRepository` you wire;
- whether the platform schedules the runs, or your scheduler calls them (`invoices.includeCron` of
  the module options).

## 2. Numbered

**What SaaSiCat does.** Invoice numbers run without gaps in one range per issuer, starting again at
1 each year as the installation's time zone counts it (`SC-PRIC-072`). The number is drawn in the
transaction that writes the invoice, after its content has passed the adapter's check, so an invoice
that is refused or fails leaves no gap. A cancellation invoice and a replacement take numbers of the
same range.

The prefix in front of each number cannot change once an invoice carries it: the start refuses
another (`SC-PRIC-024`). The start also refuses an issuer in `config/saas.yaml` that names another
legal entity while contracts with the one before still run, and names those contracts: an invoice
never asks for payment on behalf of an entity its contract was not concluded with, and moving a
contract to another entity is a transfer, not an edit of a setting (`SC-PRIC-092`). The record of
the applied settings is what the start compares against, and it keeps a correction of the same
entity once the file declares one (`SC-CFG-025`).

**What your installation decides.**

- the prefix: `invoicing.numberPrefix` — `AHP` gives `AHP-2026-000123`;
- whether a changed name or tax identifier of the issuer corrects the same legal entity:
  `issuer.correctionOf`, which the record keeps.

## 3. Corrected

**What SaaSiCat does.** An issued invoice is never edited. It is corrected by cancelling it, only
once its document is archived, by the operator with the second factor and a written reason
(`SC-PRIC-095`, `SC-ADM-019`, `SC-ADM-020`) — in the administration or with `saasicat invoices
cancel --invoice <number>`. The cancellation invoice cancels the whole invoice, names it and the
reason, and keeps everything of the invoice it cancels; where something is still owed, a replacement
under a new number names the invoice it replaces (`SC-PRIC-089`). The operator may say, line by line,
what of the cancelled invoice is not owed or owed at less (`SC-ADM-035`), and correct a party detail
that was wrong, which the replacement carries.

What was paid against the cancelled invoice moves to the replacement, and what exceeds it becomes a
credit the operator pays out; a credit is never offset against a later invoice (`SC-PRIC-083`). The
cancellation, its replacement and the movement of what was paid are written in one transaction, and
the audit log records `SUBSCRIPTION_INVOICE_CANCELLED` with the operator and the reason. Each invoice
in the subscriber's record says what it corrects and what cancelled it (`SC-ADM-040`).

**What your installation decides.** Who may cancel: the operators your administration lets in, whom
the manifest offers `invoices.cancel`, and who holds a second factor.

## 4. Archived

**What SaaSiCat does.** Once issued, an invoice is rendered from what it records and nothing else,
so the same invoice renders the same bytes every time (`SC-AUD-019`). The tax adapter checks the file
against the format its law requires — for `@saasicat/tax-de`, ZUGFeRD in the EN 16931 profile — and
a file it refuses is not archived (`SC-PRIC-042`); the invoice keeps its number and waits, recorded
as `SUBSCRIPTION_INVOICE_DOCUMENT_HELD`. The file's SHA-256 is recorded with the invoice before the
file is archived (`SC-AUD-019`). Until the archive confirms, the invoice is neither sent nor offered
for download, and an attempt repeated after an interruption is the same write under the same number
(`SC-PRIC-033`); a rendering that differs because the renderer was updated meanwhile is recorded as
`SUBSCRIPTION_INVOICE_DOCUMENT_RERENDERED` with both checksums.

The archive the persistence bundle binds is the database: `subscription_invoice_archive`, whose
triggers refuse every update, delete and truncate (`SC-AUD-014`). The start refuses invoicing beside
an archive whose triggers are missing or disabled. Once archived, the invoice is mailed to the
subscriber's invoice email with its file attached (`SC-PRIC-094`), recorded as
`SUBSCRIPTION_INVOICE_DELIVERY_HELD` or `SUBSCRIPTION_INVOICE_DELIVERY_FAILED` where it cannot be.
Every contract's confirmation goes the same way (`SC-AUD-016`): rendered, archived in
`contract_confirmation_archive`, and mailed with the terms the contract was concluded under.

**What your installation decides.**

- the renderer, `InvoiceRenderer` — `@saasicat/invoice-zugferd`'s, whose output CI checks with the
  format's own validators (`SC-PRIC-078`), or one of your own — and the confirmations' renderer,
  `ContractConfirmationRenderer`;
- the archives, `InvoiceArchivePort` and `ContractConfirmationArchivePort`, with the records of the
  confirmations, `ContractConfirmationRepository`: the database, as the bundle binds them, or a
  store of your own, such as object storage with a retention lock, whose `protectionProblem()` says
  what would let it change a file it keeps;
- the mail, `InvoiceMailPort`: how the message is worded and sent.

## 5. Accessed

**What SaaSiCat does.** The operator reads the invoices in the administration, behind its guards:
the register of every invoice by issue date with totals per month, tax treatment and rate
(`SC-ADM-042`), the subscriber's record with its invoices, and each invoice's document at
`GET admin/invoices/:id/document`, which answers the archived file, checked against the recorded
checksum, never a new rendering; a file that no longer matches is not handed out and is recorded as
`SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH` (`SC-AUD-019`). The days it shows are days of the
installation (`SC-ADM-048`).

For an auditor's or a tax advisor's access to the data (_Datenzugriff_), the register is exported as
of a stated moment: one ZIP with the invoices, their lines and what settled each, in CSV and JSON,
with a manifest naming the period, the moment and the checksum of every file, whose bytes repeat for
the same period and moment (`SC-ADM-043`, `SC-ADM-047`) — from the administration or with `saasicat
invoices export`. Each export is recorded as `SUBSCRIPTION_INVOICES_EXPORTED`, and every
administrative action records who did it, from where and when (`SC-AUD-001`).

The subscriber receives each invoice by mail with its file (`SC-PRIC-094`).

**What your installation decides.** Who the operators are: the guards and the authentication of your
administration, the roles that reach it, and which operators the manifest offers `invoices.read`.
The payment gateway an invoice is collected through, and where what it brings is recorded:
`payments.accounts`, `payments.newPaymentMethods`, `payments.returnUrlOrigins`, with
`InvoiceCollectionRepository`, `SubscriptionNoticeRepository` and `SubscriberPaymentRepository`.

## 6. Kept

**What SaaSiCat does.** SaaSiCat deletes nothing it keeps for tax purposes: an issued invoice, its
archived document, a contract and its confirmation stay, and removing records whose retention period
has passed is not built (`SC-PRIV-012`). The archive's triggers refuse to change or remove a file it
keeps (`SC-AUD-014`).

**What your installation decides.** Keeping the documents is the operator's duty. In Germany an
invoice is kept for 8 years from the end of the calendar year it was issued in (§ 14b UStG, § 147
AO), unaltered and readable throughout, in Germany or, electronically, in another member state of
the European Union. The database archive keeps what it is given for as long as the database does:
include `subscription_invoice_archive` and `contract_confirmation_archive` in every backup, and
restore them whole.

## What your own procedure documentation adds

What SaaSiCat cannot know, and an auditor asks for:

- where the installation runs: the hosting, the database, its backups and how a restore is tested;
- who the operators are, how one is let in, and that each holds a second factor;
- who watches the runs and acts on what the audit log records as held or failed;
- which versions of the tax adapter and the renderer are in use, and how an update is tested before
  it is deployed — each invoice records the adapter's name and version;
- where the archive lives and how long it is kept, where it is a store of your own;
- how the mail is worded and sent, and how the payment gateway's payouts are reconciled with the
  bank.

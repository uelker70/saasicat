---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': minor
'@saasicat/invoice-zugferd': minor
'@saasicat/tax-de': minor
'@saasicat/ui-vue': minor
---

An issued invoice is corrected by a cancellation invoice and its replacement

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

`zugferdInvoiceRenderer()` states what a replacement took over as paid, on its
page and as BT-113, and the amount due less it, and announces a direct debit of
the rest alone; `@saasicat/tax-de`'s check refuses
a document whose prepaid amount or amount due is not what the invoice records.
The tenant page names a credit a cancellation left by the cancelled invoice.

---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/cli': minor
'@saasicat/ui-vue': minor
---

The operator says, line by line, what of a cancelled invoice is still owed

`GET admin/tenants/:slug/invoices/:invoiceId` answers an invoice with its
lines (`AdminInvoice`), each with what its charge stands at — an earlier
cancellation's correction included — and whether a cancellation may name it
as not owed, or owed in part (`correctable`); the cancellation accepts
exactly the lines it offers, by one rule (`lineStandingsOf`). The
cancellation routes take `lines`, `{ position, owed }` each:
`CancelInvoiceDto` declares them as `InvoiceLineOwedDto`, so a
`ValidationPipe` with `whitelist` keeps them, and a position or an amount
that is no number is refused before the service reads it. The audit entry
names each line that moved, from what to what.

`lines` in `InvoiceCancellationPlan` and `CancelledInvoice` are now in the
invoice's currency, as every other amount the administration reads, rather
than in cents (`AdminCorrectedInvoiceLine`); the preview's replacement
carries its lines (`AdminReplacementLine`).

`<app> invoices cancel` takes `--line 2=not-owed` or `--line 2=24.50`,
repeatable; the amount takes a dot and at most two decimals, and a comma is
refused rather than read as a locale would read it. The preview prints each
line that moves and the replacement's lines.

The cancel dialog on the tenant page lists the invoice's lines with a choice
at each one that may be corrected — owed, not owed, or owed in part with the
amount — and says why the others offer none; the preview shows each line that
moves, from what to what, and the replacement's lines, a correction naming the
item it corrects (`SC-ADM-035`).

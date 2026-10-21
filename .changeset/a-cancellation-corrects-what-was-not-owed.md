---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': minor
'@saasicat/invoice-zugferd': minor
'@saasicat/cli': patch
'@saasicat/ui-vue': patch
---

A cancellation corrects what was not owed, line by line

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

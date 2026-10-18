---
'@saasicat/core': minor
'@saasicat/invoice-zugferd': minor
'@saasicat/tax-de': minor
---

A cancellation invoice and its replacement are rendered as what they are

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

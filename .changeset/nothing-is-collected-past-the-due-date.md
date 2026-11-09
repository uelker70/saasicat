---
'@saasicat/core': minor
'@saasicat/nest': minor
---

Nothing is collected past an invoice's due date of the platform's own

After a failed collection the platform tries again only where that reaches
the account by the invoice's due date: the same card seven days after a
failure whose reason can pass, or a payment method the subscriber entered
before the failure was learned. A refused direct debit is no longer announced
again, and after a reversal another payment method in use collects only by the
due date. Past it, the subscriber starts the payment — paying now, or entering
a payment method, which collects at once. A collection planned before this
release is taken up as it was planned, past the due date included; the rule
applies to what is planned from now on.

The failure and the reversal notices say so: `next.action` gains `pay-now`,
where the payment method in use can still pay the invoice, and both notices
carry `readOnlyFrom`, the day the tenant is read-only from until the invoice
is paid — the due date, or the day the failure or reversal was learned where
that is later — or `null` where what follows collects it by then, or where
unpaid invoices hold no tenant back. An `InvoiceMailPort.tell` of your own
words both. A notice recorded before reads back with `readOnlyFrom: null`.

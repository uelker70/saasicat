---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

An invoice in the subscriber's record says where its payment stands

Each invoice in the operator's record of a subscriber now names the
replacement that took its place, and says where its payment stands: open,
overdue, open in part with what it still owes, paid on a day, its payment
reversed on a day, to be refunded, or refunded on a day — every day the
installation's (`SC-ADM-051`). `GET admin/subscribers/:id/payments` answers
`replacedBy` and `payment` beside each invoice, and the record shows the
payment in a column of its own.

The rule is `invoiceStandingsOf` in `@saasicat/core`, read from the invoices,
their settlements and the subscriber's credits; a payment a cancellation moved
into the replacement counts from the day it arrived. In `@saasicat/ui-vue`,
`invoiceStandingOf` takes a `replacedBy` message beside its three, and
`invoicePaymentOf` words the payment.

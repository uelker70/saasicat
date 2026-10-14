---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

A failed collection is tried once more, and the subscriber is told

A collection that fails is told to the subscriber at their invoice email, with
the invoice, the amount, the reason and what follows (`SC-PRIC-080`). Where the
reason can pass — funds short, a refusal without a cause — the same payment
method is charged once more: a card seven days after the failure, a direct debit
on the day its new announcement names, seven days after at the earliest. A
second failure, and one for any other reason, is not tried again, and the
subscriber is asked to replace the payment method. `SC-PRIC-081` replaces
`SC-PRIC-035`, whose "the gateway retries" no gateway did.

A payment method that replaced the one an invoice named, or the one that failed,
collects the invoice: a card at once, a direct debit from the day a new
announcement names (`SC-PRIC-082`, replacing `SC-PRIC-079`). A direct debit
whose invoice reached the subscriber less than the lead time before its date is
announced again rather than left waiting. A new announcement names the amount,
the day and the mandate reference, its day is fixed when it goes out, and it
leaves the invoice as issued (`SC-PRIC-028`).

Every attempt after the first is planned first: `SCHEDULED` for its day in
`subscription_invoice_collections`, `WITHDRAWN` where its payment method was
replaced before that day. `InvoiceCollectionRepository.startAttempt` starts only
an invoice's first attempt now, so a run that found an invoice due before
another run's attempt failed no longer charges it again at once; `plan` writes a
later one only after the attempt the decision read. The repository gains
`plan`, `announce`, `submitPlanned`, `withdraw` — both in the invoice's turn —,
`listPlanned`, `listToFollowUp`, `listCollectableAgain` and `markFollowedUp`,
and a persistence contract harness runs their scenarios; `listCollectableAgain`
reads `subscriber_payment_methods`, so the collection scenarios need the
payment methods too.

`InvoiceMailPort` gains `tell({ notice, to })` for what the subscriber is told:
a `CollectionFailedNotice` or a `CollectionAnnouncedNotice`. Each is recorded in
`subscription_notices` under the kinds `collection-failed` and
`collection-announced`, and sent once. `SaaSiCatModule` takes
`persistence.tenantBilling.subscriptionNotices` for
`chargeJournal.invoices.notices`, which collecting now requires.
`SUBSCRIPTION_INVOICE_NO_PAYMENT_METHOD` replaces
`SUBSCRIPTION_INVOICE_PAYMENT_METHOD_CHANGED`, and
`SUBSCRIPTION_INVOICE_ANNOUNCED_TOO_LATE` is gone: neither case waits any more.
`1.0-an-invoice-is-collected.postgres.sql` and fragment 23 carry the planned
attempts' columns; the migration adds them, and replaces the partial index, on
a table that exists without them.

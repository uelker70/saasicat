---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/payment-stripe': minor
---

An invoice is collected through its payment gateway

Where `config/saas.yaml` names `payments`, an invoice that announced how it is
paid is collected through the gateway account its payment method is held at, as
the fourth step of the quarter-hourly run, once it was mailed: by card at once,
by direct debit from the collection date it announced (`SC-PRIC-079`). It is
collected only as it announced it — where the payment method in use is another,
or a direct debit's invoice reached the subscriber less than the lead time
before its date, it waits, and the audit log says why.

A collection never charges twice (`SC-PRIC-034`). Each attempt is started in
the invoice's turn and written as submitted, with everything its request
carries, before the request leaves; an invoice has one attempt not settled at a
time and none after one succeeded. Every request carries the key
`saasicat:collect:<invoice>:<attempt>`. A request whose answer was lost is asked
about at the gateway fifteen minutes later, and sent again as the same request
only where the gateway holds nothing under its key; a direct debit on its way is
asked about once an hour. A failure is recorded with its reason and the
gateway's code. It is not retried yet, and the subscriber is not told yet.

`PaymentGateway` gains `collect` and `findCollection`, which
`@saasicat/payment-stripe` implements with payment intents confirmed off
session under the attempt key, and `DevPaymentGateway` in memory. A restricted
Stripe key needs payment intents (write) and charges (read) beside what it had.
The Stripe gateway now refuses a currency Stripe does not take to the cent,
such as `JPY` or `ISK`, and answers an invoice in another currency than its
account's as failed with the code `saasicat_other_currency`, without sending
anything.

Adopt `23-subscription-invoice-collection.prisma`, run
`1.0-an-invoice-is-collected.postgres.sql` once before `db push`, and pass
`persistence.entitlement.invoiceCollectionRepository` as
`tenantBilling.chargeJournal.invoices.collections`; the start refuses invoices
without it where the file names `payments`, and refuses to start while a
collection not settled was sent to an account the file no longer names
(`SC-PRIC-030`). A persistence contract harness gains
`invoiceCollectionRepository`, or declares `gaps: ['invoiceCollections']`.

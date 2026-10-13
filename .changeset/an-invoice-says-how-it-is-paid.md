---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/invoice-zugferd': minor
---

An invoice says how it is paid

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

An invoice that asks for nothing, one of a subscriber without a payment method,
and one of a direct debit whose gateway never named its mandate reference record
none and are not collected; the last is said in the log.

`zugferdInvoiceRenderer()` states it on the page, in German and English, and in
the XML: the payment means (`59` for a direct debit, `48` for a card named by
its last four digits), the payment terms' text and the mandate reference.

Run `1.0-an-invoice-says-how-it-is-paid.postgres.sql` once, before `db push`:
it adds the nullable `payment` and `collectionDate` to `subscription_invoices`,
which fragment 20 declares. An invoice issued before records no payment method
and stays due on the day it states. Where `config/saas.yaml` names `payments`,
the start refuses invoices that cannot read the payment methods, as with
`PaymentsModule` wired other than globally.

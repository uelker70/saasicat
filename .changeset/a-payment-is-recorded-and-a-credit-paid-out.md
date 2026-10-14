---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/payment-stripe': minor
'@saasicat/ui-vue': minor
---

A payment is recorded once, and a credit is paid out by the operator

What a collection brought is recorded with its outcome, on one transaction and
in the invoice's turn: the payment, once, by its gateway account and the
gateway's reference, whether the run asking or the gateway's callback reports
it first, and however often (`SC-PRIC-029`). It settles what its invoice still
owes; what it brought beyond that is a credit on the subscriber's account, and
so is an invoice whose total is negative, which the quarter-hourly run credits
right after issuing it. A credit is never offset against a later invoice: the
operator pays it out, by a refund in the gateway — recorded against the credit
its payment left first, then the oldest, and given back when it fails — or,
where the gateway can no longer refund, by a transfer recorded on the tenant's
page (`SC-PRIC-083`). SaaSiCat initiates neither.

`subscriber_payments`, `subscription_invoice_settlements`, `subscriber_credits`,
`subscriber_credit_entries` and `subscriber_refunds` come with fragment 24 and
`1.0-a-payment-is-recorded.postgres.sql`, behind the new
`SubscriberPaymentRepository`, which `SaaSiCatModule` takes from
`persistence.entitlement.subscriberPaymentRepository` for
`chargeJournal.invoices.payments`; collecting now requires it.

A success in `CollectionOutcome` names what the gateway received, as
`amountCents` and `currency`. `PaymentGatewayEvent` gains
`collection-reported` and `refund-reported`, and the Stripe adapter maps
`payment_intent.succeeded`, `.processing`, `.payment_failed`, `.canceled` and
`refund.created`, `.updated`, `.failed` to them, each read again from Stripe;
a restricted key needs refunds (read). A success reported for an attempt
recorded as failed is recorded too: the attempt succeeds and what was planned
after it is withdrawn. `InvoiceCollectionRepository` gains `findByKey`.

The operator reads a subscriber's credits on the tenant's page
(`GET admin/tenants/:slug/credits`, `credits.read`) and records a payout
against one with the second factor
(`POST admin/tenants/:slug/credits/:creditId/payouts`, `credits.payout`),
refused beyond what the credit owes (`SUBSCRIBER_PAYOUT_EXCEEDS_CREDIT`), on a
day still to come (`SUBSCRIBER_PAYOUT_NOT_MADE_YET`) and for another
subscriber's credit (`SUBSCRIBER_CREDIT_NOT_FOUND`).

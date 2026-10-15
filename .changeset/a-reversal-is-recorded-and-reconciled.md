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

A reversal takes a payment back, and what matched nothing is reconciled

A direct debit the bank returned and a chargeback are recorded as reversals of
the payment they take back, once however often and in whatever order they are
reported (`SC-PRIC-084`, superseding `SC-PRIC-031`): the credit the payment left
goes first — its open part shrinks it, a part already paid out is a case to
reconcile —, then an open credit another payment collected for the same invoice
left (`SC-PRIC-087`), and only what remains opens the invoice again; reversals
of two payments of one invoice end alike in either order (`SC-PRIC-088`). The
attempt that collected the payment is then `REVERSED`, also one that had failed
before its payment arrived late: once no other attempt of the invoice is on its
way, the next run tells the subscriber at the invoice email, as a
`CollectionReversedNotice` through `InvoiceMailPort.tell`, and the invoice is
collected again only with a payment method none of its payments was reversed on
(`SC-PRIC-085`); an attempt of it that succeeded is marked `REVERSED` as well,
so it keeps no other from being made. A dispute won takes its reversal back part
for part — the cases it opened first, then the credit, then the invoice —, and
what the invoice no longer owes because it was paid meanwhile becomes a credit
(`SC-PRIC-086`).

What the gateway reports and no credit matches — the part of a refund no credit
takes, the part of a reversal that meets a credit already paid out — is a case
to reconcile: on the administration's new reconciliation page and on the
tenant's page beside its invoices with what each still owes, closed by the
operator with a note behind the second factor (`SC-ADM-033`). A refund that
fails and a reversal given back close the cases they opened.

Fragment 24 gains `SubscriberReversal` and `SubscriberReconciliationCase`, and
the columns that name a reversal on the settlements, the credit entries and the
credits; `1.0-a-payment-is-recorded.postgres.sql` creates and adds them where
its earlier version ran. `SubscriberPaymentRepository` gains `recordReversal`,
`listCases`, `closeCase`, `owedByInvoices`, `findReversalById` and
`accountsHoldingCredits`; `InvoiceCollectionRepository` gains `markReversed`.
`PaymentGatewayEvent` gains `reversal-reported`, which the Stripe adapter maps
from `charge.dispute.*`; a restricted key needs disputes (read). The routes
`GET admin/reconciliation`, `POST admin/reconciliation/:caseId/close` and
`GET admin/tenants/:slug/payments` come with the capabilities
`reconciliation.read`, `reconciliation.close` and `payments.read`; the codes
`SUBSCRIBER_RECONCILIATION_CASE_NOT_FOUND` and
`SUBSCRIBER_RECONCILIATION_CASE_CLOSED` are new. The start refuses while a
credit not paid out is held at an account `config/saas.yaml` no longer names
(`SC-PRIC-030`).

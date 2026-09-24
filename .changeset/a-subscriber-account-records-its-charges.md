---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

A subscriber's account records the charges its contracts give rise to

A journal of what each subscriber owes (`SubscriberLedgerEntry`, optional):
one charge per contract line and period — the plan, each add-on booking, a
discount — derived from the contract in force, the billing windows and the
bookings, net, with its currency and period, and written once however often
and however concurrently it is derived (`SC-PRIC-053`). Every period is
charged at the price in force when it starts, a skipped one too
(`SC-PRIC-054`); nothing in a trial, without a contract, before a period
starts or from a cancellation's effective date (`SC-PRIC-055`). A charge
carries no tax; the invoice decides it (`SC-PRIC-056`). A discount is charged
for the periods it was concluded for (`SC-PRIC-057`). A charge is rounded
once and never edited (`SC-PRIC-018`, `SC-PRIC-020`).

- `tenantBilling.chargeJournal: { ledgerRepository }` enables it beside
  `contractFreeze`, and `SubscriberChargeService.recordDueCharges(tenantId)`
  is what an application calls at activation and from its renewal job. The
  platform calls it after onboarding and after an add-on booking.
- `SubscriberLedgerRepository` in `@saasicat/core`, with both shipped adapters
  (`persistence.entitlement.subscriberLedgerRepository`), the Prisma fragment
  `15-subscriber-ledger.prisma` and the migration
  `1.0-a-subscriber-account-records-its-charges.postgres.sql`.
- The persistence contract holds an adapter to it (`subscriberLedgerRepository`,
  gap `subscriberLedger`).
- `@saasicat/spec` exports `subscriberLedgerSchema` in place of
  `tenantLedgerSchema`, which nothing read.

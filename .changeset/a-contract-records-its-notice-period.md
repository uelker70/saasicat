---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': minor
---

A contract records the notice period it was concluded with

Every contract records the days of notice of its rhythm as
`config/saas.yaml#tenantBilling.cancellationNoticeDays` names them when it is
concluded or changed (`cancellationNoticeDays` on
`SubscriptionContractRecord`), and a cancellation is judged by the contract in
force rather than by what the file names since (`SC-CANC-025`). Without a
contract in force — an installation that keeps no contracts, or a
subscription nothing was confirmed for — the file decides as before.

Fragment 08 gains the column, `constraints.postgres.sql` the check
`subscription_contracts_notice_is_days`, and
`1.0-a-contract-records-its-notice-period.postgres.sql` fills it for the
contracts already there from the two numbers set for the session
(`SET saasicat.cancellation_notice_days_monthly = …` and `…_yearly = …`),
refusing with a sentence where they are missing. Both adapters write and read
it, and `toSubscriptionContractRecord` refuses a value that is no whole number
of days of at least none. `SubscriptionContractService` reads the settings of
the file and refuses to start without them.

Invoicing no longer starts without a payment gateway: `config/saas.yaml` names
`payments` wherever it names `invoicing`, since an invoice would otherwise
stand open with nothing that could collect it.

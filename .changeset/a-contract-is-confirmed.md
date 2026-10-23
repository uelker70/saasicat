---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': minor
'@saasicat/invoice-zugferd': minor
---

Every contract is confirmed to its subscriber

A contract written from this release on gives its subscriber a confirmation
to keep (`SC-AUD-016`): rendered from the contract, archived write-once like
an invoice's document, and mailed to the invoice email with the terms of the
version the contract records. It states the whole contract in force and names
the contract and the day it was written. A contract written before is not
confirmed, and one whose parties a migration copied, or whose terms the
archive does not hold, waits and is recorded in the audit log.

Breaking for an installation that issues invoices: invoicing no longer starts
without the confirmations. Pass `chargeJournal.invoices.confirmations` with a
`renderer` — `contractConfirmationRenderer()` from `@saasicat/invoice-zugferd`
is the default — and `InvoiceMailPort` gains
`deliverConfirmation({ contract, to, documents })`. `SaaSiCatModule` takes the
record and the archive from the persistence bundle
(`entitlement.contractConfirmationRepository` and
`entitlement.contractConfirmationArchive`, both adapters); the start refuses
one whose triggers are missing or disabled.

Fragment 26 adds `ContractConfirmation` and `ContractConfirmationArchive`, and
fragment 08 gives `SubscriptionContract` the column `confirmationDue`, false by
default so `db push` leaves the contracts already there unconfirmed; both
adapters write it true on every contract they create. Run
`1.0-a-contract-confirmation-is-archived.postgres.sql` after `db push`, which
adds the archive's triggers. `ContractConfirmationService` runs in the
quarter-hourly invoice run, and the operator downloads a confirmation at
`GET admin/contracts/:id/confirmation`. The persistence contract gains the
`contractConfirmations` and `contractConfirmationArchive` parts and the seed
`markContractWrittenBeforeConfirmations`.

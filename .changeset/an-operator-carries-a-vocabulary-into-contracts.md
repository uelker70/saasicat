---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/cli': minor
---

An operator can carry a changed feature vocabulary into running contracts

A contract keeps the feature keys it was frozen with, so a key renamed, added
or dropped in a plan version afterwards does not reach it. `<app> doctor` now
names each contract in force whose frozen features hold a key neither the code
nor the catalogue knows, or lack one the versions it covers grant today and no
`replaces` declaration carries it to (`SC-ENTL-022`). It changes nothing.

`<app> contracts refresh --all` (or `--contract <id>`) shows, per contract,
what carrying the vocabulary over would change — features, quotas, price, tax
rate, currency — and writes only with `--apply` (`SC-ENTL-023`). By default it
replaces the frozen features alone and copies the lines, prices, terms and the
parties agreed. `--full` re-freezes the contract the way a plan change does,
which also leaves out an add-on whose cancellation is declared, and refuses
every contract whose price, tax rate or currency would change. Either way the
contract in force is kept, superseded, beside its successor, and the audit log
records it. Guide: "Change the feature vocabulary".

- `ContractRefreshService` (tenant billing, where `contractFreeze` is on) and,
  in `@saasicat/cli`, `ContractRefreshCliFlow`, `ContractsCommands`,
  `ContractsRefreshCommand` and `ContractFeaturesDoctorCheck`, which joins
  `PLATFORM_DOCTOR_CHECK_PROVIDERS` and passes where contracts are not frozen.
- `SubscriptionContractRepository.supersede` ends a contract only while it is
  still as the caller read it — its status and its `effectiveUntil` — in one
  conditional statement, on the caller's transaction where it passes one. A
  repository of your own adds it; both shipped adapters have it, and the
  persistence contract holds it to two concurrent writers. `create` writes
  `partiesMigrated`.
- A plan change now writes its successor and the end of the contract it
  replaces on one transaction, and refuses with `SUBSCRIPTION_CONTRACT_CHANGED`
  rather than leave two contracts in force: where the contract moved twice in
  between, or where, with none in force at its moment, a contract of the tenant
  begins after it. `SaaSiCatModule.forRoot` passes its transaction runner;
  `contractFreeze.transactionRunner` and the `SubscriptionContractModule`
  option of the same name take one where the modules are wired by hand —
  without one the two writes are separate, and that guarantee does not hold.
- `EntitlementService.computeContractLimits` no longer reads the contract in
  force: it answers what a contract frozen now records.

---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': minor
---

The operator reads a tenant's contracts with their confirmations

`GET admin/tenants/:slug/contracts` answers every contract of a tenant — in
force, superseded and ended — the newest first, each with its start, rhythm,
price, the version of the terms and the notice period it records, and where
its confirmation stands: `not-due`, `being-made`, `awaiting-mail` or `sent`
(`AdminTenantContracts`, `confirmationStateOf`). The manifest announces it
with the confirmation's download as `contracts.read`.

`ContractConfirmationRepository` gains `listStandings(contractIds)`, which
both adapters implement and the persistence contract holds: whether each
contract is due a confirmation and where its confirmation stands. A
repository of your own adds it. An application that wires
`InvoiceDocumentModule` itself with `confirmations: true` brings the
administration's `AdminResourcesService` into its `imports` too.

`SC-SCOPE-011` is delivered: SaaSiCat invoices subscriptions and collects
payment through a payment gateway, which supersedes `SC-SCOPE-004` and
`SC-PRIC-001`. The guides no longer hold invoicing back from real customers.

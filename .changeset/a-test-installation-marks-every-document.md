---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/cli': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/invoice-zugferd': minor
'@saasicat/tax-de': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A test installation marks every document it issues as a test

An installation that tries invoicing out beside production issues documents
that look like real ones, and a recipient, a tax advisor or an auditor could
take one for a real invoice. Mark its database with
`<app> installation mark <identifier> --operation test`, before its first
document, and every invoice, cancellation invoice, replacement and contract
confirmation it issues is titled as a test and states under its title and at
the foot of every page that it is no invoice for VAT purposes, or confirms no
contract; an invoice's XML states the same as its first note (`SC-AUD-024`).
Amounts, tax and due date stay as they are. Every list of invoices and
confirmations marks such a document "Test" (`SC-UI-029`). An installation that
never tests changes nothing it configures.

- Each invoice records the operation it was issued in, a cancellation invoice
  and its replacement the one of the invoice they correct, and a confirmation
  the one of its first rendering; every later rendering and mail read the
  record. The first document fixes the installation's operation: the command
  refuses another (`INSTALLATION_OPERATION_FIXED`) and any change where the
  documents cannot be read (`INSTALLATION_DOCUMENTS_NOT_READABLE`), and a start
  that issues invoices refuses where the documents recorded another operation
  than the mark (`SC-AUD-023`).
- An operator's command line starts there all the same: `installation status`
  and the doctor name the disagreement, and marking the operation the documents
  recorded repairs it. Instead of its start, it refuses each invoice or first
  confirmation it would issue while the two disagree. `CliContextModule` imports
  `OperatorCommandLineModule` from `@saasicat/nest`, which declares the process
  one; a command line built without it imports that itself. Where the documents
  recorded both operations, nothing repairs the installation: it issues no
  further document.
- `@saasicat/core` adds `TEST_OPERATION_TITLE` and `TEST_OPERATION_NOTICE`, the
  wording in German and English; it waits for a tax advisor's confirmation.
- `@saasicat/invoice-zugferd` prints it on both renderers, and
  `@saasicat/tax-de` holds an invoice whose XML does not state the notice
  first, or a live one that states it.

**Breaking:**

- `@saasicat/spec` ships `1.0-the-test-operation-is-recorded.postgres.sql`,
  safe to run twice, and the column in fragments `20` and `26`. Run it before
  `db push` where invoices are issued.
- `SubscriptionInvoiceRecord`, `NewSubscriptionInvoice`, `InvoiceDraftInput`,
  `ContractConfirmationRecord`, `NewContractConfirmationRendering`,
  `ContractToConfirm` and `ContractConfirmationMail` gain `testOperation`.
  `SubscriptionInvoiceRepository` gains `issuedOperations()`,
  `ContractConfirmationRepository` gains `recordedOperations()`, and its
  `replaceRendering` takes a `ContractConfirmationReplacement`. Both shipped
  adapters have them, held to the persistence contract.
- A renderer of your own prints the title and the notice where `testOperation`
  is `true`; a mail port of yours says so.
- `TenantInvoice`, `TenantContractConfirmation`, `AdminInvoiceRegisterRow`,
  `AdminSubscriberInvoice`, `AdminOpenInvoice`, `AdminContractInvoice` and
  `AdminSubscriberContract.confirmation` gain `testOperation`.
- The export's `invoices.csv` and `export.json` gain `operation`, `test` or
  `live`, after `kind`: every later column moves by one.
- `TenantBillingModule` wired by hand refuses invoices and confirmations without
  `subscriptionEnds.deletion.marks`, and takes
  `subscriptionEnds.deletion.documents` where invoicing is off.
- `TenantPlanSectionI18n` gains `invoiceTestOperation`,
  `invoicesDownloadTestInvoice` and `confirmationDownloadTest`;
  `@saasicat/ui-vue` adds three messages, `invoiceDownloadLabelOf` and
  `TEST_OPERATION_TONE`.

See `docs/guides/upgrade-to-1.0.md`.

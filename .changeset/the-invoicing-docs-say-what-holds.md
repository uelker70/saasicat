---
'@saasicat/spec': patch
'@saasicat/ui-vue': patch
---

The invoicing documentation says what holds

- `sql/1.0-an-invoice-is-issued.postgres.sql` said in its header that no invoice
  is issued for a charge before invoicing is switched on. The file itself issues
  none, but the first invoice run invoices every charge of the journal that
  stands on no invoice, however long ago its period was. The header now
  says so; its SQL is unchanged.
- The README of `@saasicat/ui-vue` names the operator's billing pages —
  `SubscribersPage`, `SubscriberRecordPage`, `InvoicesPage`, `ContractsPage`,
  `OpenItemsPage` and `ReconciliationPage` — with what each needs: the backend
  mounts their routes only where `adminResources` is on.

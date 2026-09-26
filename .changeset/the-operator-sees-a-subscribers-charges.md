---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/ui-vue': minor
---

The operator sees a subscriber's charges on the tenant's page

Where the platform keeps a charge journal (`tenantBilling.chargeJournal`) and
shows tenants (`adminResources`), it serves `GET admin/tenants/:slug/charges`
behind the administration's guards and announces it in the manifest as
`charges.read`. `TenantDetailPage` then shows a section with the charges of the
tenant's subscriber, newest first: the title of each charge's contract line,
its period, what made it arise, when it became due, and its net amount — and
whose account it is, by customer number and legal name. There is no total:
without invoices and payments, a sum would be read as what is owed. Without
the journal, neither the route nor the section exists.

The read runs inside `RlsBypassPort`, because an operator's request is scoped
to no tenant. Where your ledger, subscriptions, contracts or subscribers carry
a row-level policy, your implementation of that port has to lift it there.

New exports: `SubscriberAccountService` and `SubscriberAccountModule` from
`@saasicat/nest/billing` — mounted by hand, the module needs `RlsBypassPort` in
scope and does not start without it — the `AdminSubscriberAccount` types and
`SUBSCRIBER_ACCOUNT_CAPABILITY` from `@saasicat/core`, `useTenantAccount` and
`tenantsResource.charges` from `@saasicat/ui-vue`.

`admin-api.openapi.yaml` resolves its references to the JSON Schemas from the
`schemas/` directory they ship in. The manifest response pointed beside it,
where no file is, so a bundler or client generator that dereferences the
document stopped there.

---
'@saasicat/ui-vue': minor
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': minor
'@saasicat/cli': minor
---

A subscriber has a record of its own, reached without its tenant

The administration gains a page of subscribers (`SubscribersPage`, at
`subscribers`) — searched by a customer number, a legal name or a VAT number,
and narrowed to those without a live tenant — and each subscriber's record
(`SubscriberRecordPage`, at `subscribers/:id`): its master data and
corrections, every tenant it was linked to, its charges, credits, invoices
with their cancellation, and contracts. A subscriber whose tenant is gone stays
reachable there. The tenant's page keeps a card naming its subscriber and
leading into the record. Both pages appear where the manifest announces
`subscribers.read`. The theme gains `.sa-link`, the accent for a link in a
page's content that leads to another record, readable in both themes.

**Breaking:** the routes that read a subscriber through its tenant's slug are
gone. `admin/subscribers/:id/charges`, `…/credits`,
`…/credits/:creditId/payouts`, `…/payments`, `…/contracts`, `…/history`,
`…/identity`, `…/business-status` and `…/vat-id-check` take their place, and an
invoice is read and cancelled at `admin/invoices/:invoiceId`,
`…/cancellation/preview` and `…/cancellation`. `GET admin/subscribers` and
`GET admin/subscribers/:id` are new. The `@saasicat/ui-vue` names follow:
`subscribersResource` holds the subscriber's operations, `useTenantAccount`,
`useTenantCredits`, `useTenantPayments`, `useTenantContracts` and
`useTenantDownloads` are `useSubscriber…`, and `AdminTenantPayments`,
`AdminTenantInvoice` and `AdminTenantContract(s)` are `AdminSubscriber…`.

A subscriber has no live tenant only once its link is closed: an application
that deletes a tenant closes its subscriber's link, and the record names a
tenant the application no longer has as such. `AdminResourcesPort` gains
`findTenantsByIds`, `SubscriberRepository` `search` and `listTenantLinks`,
`SubscriberLedgerRepository` `listBySubscriber`, and the contracts' `list`
filter `subscriberId`; the shipped adapters implement all of them, and the
persistence contract holds them. A harness of your own adds the
`closeTenantLink` seed or declares `closedTenantLinkSeed` among its gaps.

---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/ui-vue': minor
---

A subscriber's record shows every contract as it was concluded

The contracts in a subscriber's record stand in a timeline per tenant, the
latest start first, each naming what it changed against the one in force before
it — concluded, the plan upgraded or downgraded by its net price per month or
changed at the same price, add-ons added or removed, frozen anew, cancelled —
and one superseded before it began as never in force. A day picked marks the
contracts in force on it, read in the installation's time zone. A contract opens
into what it froze: its plan, add-ons and discounts with their prices, tax,
features, quotas and minimum terms, a filter over the features and quotas, where
each line came from and whether that source is still in the catalogue, the
invoices issued under it, and its ids to copy. Its confirmation is offered for
download only where the archived file still matches its checksum, checked when
the contract is opened; otherwise the contract says so.

`GET admin/subscribers/:id/contracts/:contractId` is new, under
`contracts.read`, and refuses another subscriber's contract as one that does not
exist. `AdminSubscriberContract` gains the fields the timeline reads
(`tenantId`, `firstDay`, `lastDay`, `neverInForce`, `plan`, `bundles`,
`minimumTermUntil`, `change`), `@saasicat/core` the functions that derive them,
and `@saasicat/ui-vue` `useContractDossier`, `useCopyText` and
`servesStandardPage`. Nothing is to be wired.

A link from one standard page to another — a contract's line to the catalogue,
the way back from a subscriber's record or a tenant's page to its list — goes
where `AdminLayout`'s `standardPageRoutes` put that page, as the navigation
does, rather than to the default route (`useStandardPageRoute`,
`standardPageRouteOf`).

---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/spec': minor
'@saasicat/persistence-testing': minor
---

A tenant is deleted on its day, through the application's erasers

A tenant whose subscription ended is now deleted on its deletion day, in the
installation's zone, wherever the database is marked as the installation's own
(`SC-PRIV-022`). The application erases its stores through erasers of its own,
one per store, in the order it lists them; the platform decides the day, has
every store count what it holds before the first one erases, and keeps the
record of the deletion with the subscriber, naming no person (`SC-PRIV-023`).
After every store it counts the subscriber's contracts, charges, invoices,
payments and credits, and halts the deletion at a store that took any of them
along (`SC-PRIV-011`). A deletion that stops is taken up by the next run after
the last store that confirmed (`SC-PRIV-018`).

**Breaking: wherever `tenantBilling` is on, the application no longer starts
without `tenantBilling.subscriptionEnds.deletion.erasers` and `deletion.keep`**
(`subscription-ends.requires-erasers`,
`subscription-ends.requires-keep-report`). Both are required in
`SaaSiCatModule`'s types:

```ts
deletion: {
    installation: process.env.SAASICAT_INSTALLATION,
    erasers: [myTenantFilesEraser, myTenantDataEraser],
    keep: myKeepReport,
},
```

An eraser is a `TenantEraser`: a stable `name`, `count(tenantId)` and
`erase(tenantId)`. Each method begins with `assertOneTenant(tenantId)`, and
`erase` resolves for what is already gone. The `TenantKeepReportPort` answers
what a tenant has to keep for obligations of its own — receipts under a
retention period, say — as lines of a category, a count and its words by
locale, `en` required; every reminder carries them as `keep`, and the record
keeps them. They do not stop the deletion.

- `@saasicat/spec` ships `33-subscriber-tenant-deletion.prisma` (three models,
  `subscriber_tenant_deletion*`),
  `1.0-a-tenant-deletion-is-recorded.postgres.sql` and
  `1.0-the-ends-are-read-by-day-and-the-notices-by-tenant.postgres.sql`
  (an index on `subscription_ends."deletesOn"`, one on
  `subscription_notices."tenantId"`, and `recipientCount` and
  `recipientsForgottenAt` there), both safe to apply twice. Apply
  `1.0-a-subscriber-is-joined.postgres.sql` again after them: it guards the new
  table against a join of subscribers.
- Both adapters provide `persistence.core.tenantDeletions`, held to the
  persistence contract; a start with nowhere to keep the records, or to find a
  tenant's subscriber, is refused
  (`subscription-ends.requires-tenant-deletions`,
  `subscription-ends.requires-subscribers`).
- **Breaking for an adapter of your own:** `TenantAccessHoldPort.record` and
  `lift` take the caller's transaction, and the port adds `listAllOf`,
  `lockOpen`, `replaceActors` and `forgetNotes`; `SubscriptionEndPort` adds
  `listEndsOfTenant`, `listAnnouncedOfTenant`, `listExportDownloadsOfTenant`
  and `replaceActors`; `SubscriptionNoticeRepository.confirm` records
  `recipientCount`, and the repository adds `forgetRecipients`;
  `SubscriberJoinRepository.hold` answers each side's `deletionsUnderWay`. A
  contract harness of your own wires `tenantDeletions` or names it among its
  `gaps`.
- `TenantBillingModule` wired by hand takes `erasers`, `keep`, `records` and
  `subscribers` in `deletion`, and `transactionRunner`.
- `@saasicat/nest/billing` adds `TenantDeletionService`; the quarter-hourly run
  sets it off after the ends and the reminders without waiting for it. With
  `includeCron: false`, call `TenantDeletionService.deleteDue(new Date())`
  third. `@saasicat/nest/testing` adds `FakeTenantDeletionRepository`, which
  `FakeSubscriberJoinRepository` takes second to read deletions under way from.
- Once a tenant's deletion has begun, nobody is let in, the operator acting as
  it included; the operator cannot suspend it (`409 TENANT_DELETION_BEGUN`); no
  download of its export is recorded, not even one started before, with the
  same code, from the platform's route and from `recordDelivered` alike; no
  invoice records or lifts a reason on it, and no reminder goes to it
  (`SC-PRIV-025`); its subscriber is joined to no other until it closes
  (`409 SUBSCRIBER_JOIN_DELETION_UNDER_WAY`). When it closes, the rows the
  platform keeps of the tenant name roles instead of persons, its reasons lose
  their notes, its notices their recipients, and every reason still open but
  the deletion's own is lifted.
- A deletion does not begin while a contract of the tenant is in force at the
  end that made it due, or begins after it, such as one a checkout offer
  concluded since (`SC-PRIV-026`); the run holds it and writes nothing.
- The audit log gains `TENANT_DELETION_BEGUN`, `TENANT_DELETION_CLOSED` and
  `TENANT_DELETION_HALTED`.

The first run on a marked database deletes every tenant whose day has passed.
Write and test the erasers before you mark it. See
`docs/guides/wire-the-backend.md` and `docs/guides/upgrade-to-1.0.md`.

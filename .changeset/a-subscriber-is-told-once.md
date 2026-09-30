---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': major
---

Tell a subscriber once that a newer version of their plan is offered to them

A subscription keeps its version, and a newer one is an offer beside the plan
(`SC-SUB-020`). With `tenantBilling.versionNotices: { port }` the tenant's
administrators now hear of it once, in the application's words
(`SC-SUB-022`): when the offer appears — not when the version is published —
so a version whose window opens later is told when it opens, and a
subscription with a change still to land is told once it has landed. Each
newer version is told once per subscription; there is no reminder.

- `SubscriptionNoticePort` in `@saasicat/core` is the application's: it finds
  the tenant's administrators, words and sends the message, and answers to
  whom and through which channel. A throw is tried again by the next run; an
  answer with no recipients is recorded as told to nobody.
- The platform keeps a record of every notice (`SC-SUB-023`) in the new
  `subscription_notices` table: the subscription, what it said, when it went
  out, to whom and how, one per subscription and subject. Adopt
  `prisma-fragments/17-subscription-notice.prisma` and run
  `sql/1.0-a-subscriber-is-told-once.postgres.sql`. Both bundles provide the
  record as `tenantBilling.subscriptionNotices`, which
  `notAdopted: ['SubscriptionNotice']` leaves out.
- `VersionNoticeService.sendDue` sends what is due, across tenants inside the
  RLS bypass. `VersionNoticeCron` runs it every quarter of an hour where
  `ScheduleModule` is registered, and pauses under a maintenance lock;
  `includeCron: false` leaves it to a scheduler of the application's own.
- `SubscriptionUsagePort.listBoundToEarlierVersions` is new and optional; both
  shipped adapters have it. Version notices over a port without it, or over a
  plan repository without `findVersionById`, refuse to start, and so does a
  start with no record (`version-notices.requires-notice-record`).
- The persistence contract holds a notice record to one claim at a time. A
  harness gains the `subscriptionNotices` member, or declares
  `gaps: ['subscriptionNotices']`.

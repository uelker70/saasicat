---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/cli': minor
---

A tenant is reminded before its data is deleted

**Breaking: wherever `tenantBilling` is on, the application no longer starts
without `tenantBilling.notices.port`** (`subscription-notices.requires-port`).
It is the application's `SubscriptionNoticePort`, and every notice the platform
decides is due goes through it. The option is required in `SaaSiCatModule`'s
types, so the compiler asks for it; a start without it, from code the compiler
did not check, is refused.

**Breaking: the notice port and its record move.** `versionNotices.port` is now
`notices.port`, and `versionNotices.notices` is `notices.record`;
`versionNotices: {}` keeps the version notices on.
`chargeJournal.invoices.notices` is gone: what collecting an invoice tells its
subscriber is kept in `notices.record` too. A start that still passes any of the
three where it was is refused, naming where it moved
(`subscription-notices.no-moved-options`), and so is `TenantBillingModule`
wired by hand. The record defaults to the bundle's
`persistence.tenantBilling.subscriptionNotices` and is now required wherever
`tenantBilling` is on (`subscription-notices.requires-record`, which replaces
`version-notices.requires-notice-record`), so adopt `SubscriptionNotice`
(fragment 17) and run `1.0-a-subscriber-is-told-once.postgres.sql` where you
have not. `TenantBillingModule` wired by hand takes `notices: { port, record }`
and refuses `subscriptionEnds`, `versionNotices` or collected invoices without
it.

**Breaking: `config/saas.yaml` requires
`tenantBilling.endOfSubscription.reminderDaysBefore`**, the days before the
deletion day on which a tenant's administrators are reminded: whole numbers of
at least 1, none twice, at least one, in any order, and no default. The loader
refuses a file without it, or with a list that is empty, names a lead time
twice or holds one below 1, naming the field. An in-code `planCatalog` is held
to the schema for `tenantBilling.cancellationNoticeDays`,
`selfServiceBlockedPlans` and `endOfSubscription` where tenant billing reads
them, and a start with a malformed one is refused, naming the field.

Once a tenant's subscription has ended, its administrators are reminded by your
port before its data is deleted (`SC-CANC-022`), one new notice of kind
`deletion-reminder` per end and lead time: `tenantId`, `subscriptionId`,
`subscriptionEndId`, `daysBefore`, `readOnlyUntil` — the last day the tenant can
read and take its export — and `deletesOn`, days in the installation's zone. A
lead time of N days is due from the installation's day N days before the
deletion day. A run reminds each end of one lead time at most, the smallest that
is due and that no reminder already told covers, so lead times that passed
before the end was recorded, or while no run ran, go out as one reminder at
once; none goes twice, and from the deletion day on nothing is reminded. A
reminder told to nobody is recorded and not tried again, and the next lead time
still goes on its day; one the port throws for is tried again by the next run.
While a run holds one reminder of an end, no other of that end goes out beside
it. A suspended tenant is reminded all the same. A change to the lead times
applies once the application has restarted, to ends recorded earlier too, and
repeats no reminder already sent. A port that switches over `notice.kind`
exhaustively fails to compile until it handles the new kind; one with a
catch-all branch sends the reminder as whatever that branch sends.

The quarter-hourly `SubscriptionEndCron` records the ends and then reminds; its
method is `recordAndRemind()`, which replaces `recordEnded()`. With
`subscriptionEnds.includeCron: false` the application calls
`SubscriptionEndService.recordEnded` and then the new
`DeletionReminderService.remindDue` from its own scheduler. A
`SubscriptionEndPort` of your own adds `listDeletingAfter(day)`, every end whose
deletion day is after that day, soonest first; both shipped adapters, the
persistence contract and `FakeSubscriptionEndRepository` have it.
`deletionReminderDue` in `@saasicat/core` answers which reminder is due as a
pure rule, and `calendarDaysBetween(from, to)`, new beside it, counts the
calendar days from one day to another. The template `saasicat init` writes
carries the lead times. Nothing is deleted on the deletion day by this release.

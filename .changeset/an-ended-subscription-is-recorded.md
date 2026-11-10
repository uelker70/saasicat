---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/cli': minor
---

A subscription that ended is recorded with the day its data goes

Once a subscription's cancellation lands, a quarter-hourly run records its
end with a deletion day and holds the tenant read-only until then
(`SubscriptionEndService`, `SubscriptionEndCron`). The day is the first after
`tenantBilling.endOfSubscription.readOnlyDays`, a new required setting in
`config/saas.yaml` with no default, counted from the day the subscription
ended — or from the day the end is recorded, where that is later — and never
moved.

Adopt the `SubscriptionEnd` model (fragment 29) and run
`1.0-subscription-ends-are-kept.postgres.sql`; both shipped adapters provide
`persistence.core.subscriptionEnds`, and a start without it is refused. A
`SubscriptionUsagePort` of your own adds `listCancelled()`. The run needs
`ScheduleModule`, or `tenantBilling.subscriptionEnds.includeCron: false` and
your own call to `recordEnded`. The first run records every subscription that
ended before, with its day counted from that run. Nothing is deleted on the
day by this release. `saasicat init` writes the new setting into the
`config/saas.yaml` it creates.

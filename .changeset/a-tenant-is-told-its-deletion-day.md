---
'@saasicat/spec': minor
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant is told the day its data is deleted before it ends its subscription

Before confirming a cancellation, or ending its subscription at once while a
feature is withdrawn, the tenant reads the last day it can still read its data
on and the day the data is deleted. The day confirmed is recorded, and the end
is recorded with it once it lands: a later change to the read-only period does
not move it, and neither does an end that lands earlier than announced. Only an
end that lands later than announced is given a day counted from the period. A
first confirmation sent with a day the server no longer works out is refused
with `CANCELLATION_TERMS_CHANGED` and the day that applies now, before anything
is written; a repeat of a cancellation already told a day changes nothing and
answers the day on record. A booking that ends alone deletes nothing and states
no day. The plan card of a cancelled subscription repeats the day, the
`ended-at-once` notice of a subscription names both days as `deletion`, and the
audit entries of a cancellation and of an end at once name the day and the
period.

Adopt the `SubscriptionEndAnnouncement` model (fragment 30) and run
`1.0-subscription-ends-are-kept.postgres.sql`: it creates the announcement table
beside `subscription_ends`, and where it ran before it creates only what is
missing. Both shipped adapters provide the new `SubscriptionEndPort` methods
`announce` and `listAnnouncedFor`; a port of your own adds them, and the
persistence contract and `FakeSubscriptionEndRepository` cover them. A screen of
your own reads `cancellation.deletion` and `announcedDeletion` from
`GET billing/usage`, and sends the day it showed as `expectedDeletesOn` with
`POST billing/cancel` and with `POST billing/feature-withdrawals/:id/end`. Texts
of your own for the tenant section gain `deletionAnnounced`.

`EndAtOnceService.end` takes who confirms as a fifth argument.
`TenantBillingController`'s constructor no longer takes the notice periods, the
retirements or the contract store, and takes `SubscriptionCancellationService`
last.

Where recording the day fails, the cancellation stands, and declaring it again
records the day; an end at once stands too, is answered and audited without a
day, and is given its day when its end is recorded. A cancellation declared
before this release is told no day unless its tenant declares it again before it
lands. Nothing is deleted on the day by this release.

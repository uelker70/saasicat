---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
---

A retirement reminds a subscription once, 14 days before its date

Where staying put costs a subscription something, the quarter-hourly run
reminds it once, 14 days before the date it was told (`SC-SUB-034`). Staying
put costs something where the replacement is dearer in the rhythm the
subscription is billed in at that date, is not sold in that rhythm, or takes a
feature away or lowers a quota. A price that rises only in another rhythm is no
reason to remind. A run that did not happen on the day is caught up until the
date. Nobody is reminded who has cancelled, switched, or leaves the version by
the date through a change of their own. With
`versionNotices.includeCron: false`, call `RetirementReminderService.remindDue`
yourself.

- **A third kind of notice.** `SubscriptionNotice` gains
  `version-retirement-reminder`: what the retirement notice said — its
  `billingCycle` the rhythm billed at the date, read again as the subscription
  stands when reminded — and `switchTerms`, what a switch taken now would cost,
  or `null` where the subscription cannot switch now. It is recorded like the
  others, with its recipients and channel, once per subscription and retired
  version. A `SubscriptionNoticePort` of your own narrows on `notice.kind`: one
  that treats every notice that is not an offer as a retirement would send the
  reminder as a second announcement.
- **The plan cockpit** counts beside a retired version how many subscriptions
  were reminded: `RetirementProgress.reminded`, and the wording key
  `common.retirementProgress.reminded`.
- `retirementCostsTheSubscription`, `retirementReminderDueAt` and
  `retirementReminderIsDue` in `@saasicat/core` give the rule and the day.

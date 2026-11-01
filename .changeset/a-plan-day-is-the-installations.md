---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant's plan days are the installation's days, named by the server

The plan section wrote a moment as the browser's day, so a trial ending at
midnight in Berlin read as the first day it no longer covers, and a viewer in
New York read a different day than one in Berlin. The server now hands out,
beside each moment of the plan a tenant is shown as a day, its days in the
installation's zone — `config/saas.yaml#timeZone`, UTC where it names none —
`until`, the last day of what the moment ends, and `from`, the first of what it
begins (`SC-UI-028`).

`GET /billing/usage` gains `trialEndsDays`, `startedDays`,
`currentPeriodStartDays`, `currentPeriodEndDays`, `pendingEffectiveDays`,
`canceledDays`, `canceledEffectiveDays` and `packageSnapshotCapturedDays`,
`pilotEndsDay` (the day that was picked, the same in every zone), the days of
`cancellation` (`effectiveDays`, `termEndsDays`, `noticeDeadlineDays`) and
`effectiveDays` on a retirement on its way. `POST /billing/plan/preview` gains
`effectiveDays` and `projectedTrialEndsDays`, a change `POST /billing/plan`
schedules `pendingEffectiveDays`, and `POST /billing/cancel` the days of its
four moments. The fields are added; nothing is removed.

The last day a subscription, or an add-on booking, may be cancelled without
notice when its version is retired (`lastDayToCancel`) is the last whole day
before the date in the installation's zone rather than in UTC (`SC-SUB-046`,
`SC-BUN-066`). In an installation east of UTC whose terms end at local
midnight, a notice now names one day later than it did — the day a subscriber
there reads as the day before. A notice already sent keeps the day it named.

What the plan section shows changes where a moment falls near midnight and
where an end is shown: a trial, a cancellation and its confirmation name the
last day they cover. The plan-change wizard's sentences about what stays
unchanged take `{lastDay}`, the last day before the change, beside `{date}`,
the first day it applies; an override that still writes `{date}` there goes on
getting the first day. `TenantPlanCardHeader` takes `billsAgain` in place of
`nextBillingDate`, `VersionRetiredCard` `nextPeriodStartDay` in place of
`nextPeriodStart`, `PlanChangeWizard` `trialEndsDays` in place of
`trialEndsAt`, and `PackageSnapshotPanel` an optional `capturedDays`.

`@saasicat/core` gains `withUsageDays`, `pickedDayOf`,
`SUBSCRIPTION_USAGE_MOMENTS`, `CANCELLATION_MOMENTS` and
`CANCELLATION_RESULT_MOMENTS`, and the types `SubscriptionUsageDays`,
`UsageMoments`, `WithUsageDays`, `CancellationMoments`, `CancellationDays` and
`VersionRetiredNoticeWithDays`.

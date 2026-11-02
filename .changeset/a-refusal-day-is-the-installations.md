---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A day a refusal names is the installation's day, in the application's format

A refusal that named a day cut it out of a UTC timestamp and handed it to the
page as raw `YYYY-MM-DD` text, so a tenant switching plans read "runs until
2026-12-01 at the earliest" beside an add-on whose card said "minimum term until
30.11.2026". The server now reads each such day in the installation's zone —
`config/saas.yaml#timeZone`, UTC where it names none — and a refusal, like each
blocker of a plan change or add-on preview, says which of its `params` are days
in a new `dayParams` list. The tenant pages write exactly those through the
application's `formatDate` (`SC-UI-028`, which this completes).

The refusals concerned: `BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE`,
`BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN`,
`BUNDLE_REPLACEMENT_DOES_NOT_FIT_TARGET_PLAN`,
`RETIREMENT_SWITCH_BUNDLE_CANNOT_FOLLOW`,
`RETIREMENT_SWITCH_BUNDLE_REPLACEMENT_CANNOT_FOLLOW`,
`BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES`, `BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN`,
`BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE`, `BUNDLE_RETIREMENT_REINSTATE_REFUSED`,
`FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED`, `BUNDLE_VERSION_NOT_YET_ON_SALE` (a
picked day, already the right one, now written in the application's format)
and `NO_ACTIVE_PLAN_VERSION` for the tenant; `FEATURE_WITHDRAWAL_OVERLAPS` and
`FEATURE_WITHDRAWAL_ALREADY_LIFTED` for the operator.

Where a sentence means two days — how long an add-on still runs, and from when
the way is free — it now names both. The existing placeholder keeps its value,
so a catalogue override goes on reading the same day: `{until}` is the first
day without the add-on, `{date}` in `FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED` the
day the cancellation lands. `{lastDay}`, the last day it still runs, is added,
and the shipped English and German sentences name both: "… runs until
30.11.2026 at the earliest. Once it is cancelled, a change that takes effect on
or after 01.12.2026 goes through"; "Your cancellation is recorded and cannot be
brought forward here: it takes effect at the end of 30.11.2026, and until then
the reduction applies." The day an add-on can be booked again after a
retirement is the first whole day without the old booking in the installation's
zone, and whether the subscription still runs then is asked on that same day.

The tenant section's booking, cancellation and preview failures now show the
refusal's sentence in the reader's language, where they showed the request's
diagnostic text.

`@saasicat/core` gains `writeDayParams` and `dayParams` on `PlatformErrorBody`,
`FeatureWithdrawalBlocker` and `RetirementBlocker`; `@saasicat/ui-vue`'s
`PlanChangePreviewIssueShape` and `BundlePreviewIssueShape` gain `dayParams`.
`refusalMessage` and `issueSentence` from
`@saasicat/ui-vue-tenant/refusal-of.js` take the application's `formatDate` as
their third argument.

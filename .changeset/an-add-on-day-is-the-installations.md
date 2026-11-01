---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

A tenant's add-on days are the installation's days, named by the server

The tenant's pages wrote a moment as the browser's day, so a booking made at
00:30 in Berlin read as the day before in New York, and an end at midnight read
as the day after the last one it covers. The server now hands out, beside each
moment a tenant is shown as a day, its days in the installation's zone —
`config/saas.yaml#timeZone`, UTC where it names none: `until`, the last day of
what the moment ends, and `from`, the first of what it begins (`SC-UI-028`).

This covers the add-on bookings of `billing/subscription-bundles` (`startedDays`,
`minimumTermEndsDays`, `canceledDays`, `canceledEffectiveDays`,
`currentPeriodEndDays`, `pendingVersionEffectiveDays`, and `effectiveDays` on a
retirement notice), an add-on's preview (`firstPeriodEndDays`,
`minimumTermEndsDays`, `endsWithPlanDays`; `effectiveDays` for a cancellation),
and the version offers of a plan and of an add-on together with what taking one
answers, a refusal that carries the current offer included (`takesEffectDays`).
The fields are added; nothing is removed.

What the add-on pages show changes where a moment falls near midnight, and where
an end is shown: a minimum term, a cancellation and a preview's first period
name the last day they cover — 30 November rather than 1 December. Your
`formatDate` is handed noon of the named day in the viewer's zone, which a
formatter that reads an instant in the viewer's zone writes as that day
wherever the viewer is.

`@saasicat/core` gains `daysAround`, `withDays`, `installationZoneOf` and
`DEFAULT_INSTALLATION_ZONE`, and the types `DaysAround`, `WithDays`,
`SubscriptionBundleDays` and the `…WithDays` forms of the offers, switches and
add-on retirement notices.

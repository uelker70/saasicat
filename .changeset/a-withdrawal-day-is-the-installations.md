---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/ui-vue-tenant': minor
---

A withdrawn feature's days are the installation's days, named by the server

The withdrawal notices and the mark beside a withdrawn feature wrote a moment
as the browser's day, so a withdrawal from midnight in Berlin read as 30
November to a viewer in New York. The server now hands out, beside each moment
of a withdrawal a tenant is shown as a day, its days in the installation's
zone — `config/saas.yaml#timeZone`, UTC where it names none — `until`, the last
day of what the moment ends, and `from`, the first of what it begins
(`SC-UI-028`). Every sentence about a withdrawal says "from", "since" or "on",
so the pages write `from`.

Each mark in `withdrawn` of `GET /billing/feature-registry` gains
`effectiveFromDays` and `liftedFromDays`. `GET /billing/feature-withdrawals`
gains `effectiveFromDays` and `liftedFromDays` on each withdrawal and
`fromChangeDays` on each line, and what ending at once previews and answers
gains `endsDays`. The fields are added; nothing is removed.

`provideWithdrawnFeatures` keeps its signature: the `formatDate` you hand it is
now handed noon of the named day in the viewer's zone, as the other tenant
components' is, so a formatter that reads an instant in the viewer's zone —
`toLocaleDateString` without a `timeZone` — writes the named day wherever the
viewer is. A test of your own that builds a mark for `WithdrawnFeatureMark`
gives it `effectiveFromDays` and `liftedFromDays`; without them the mark writes
a dash, as it does for a server that names no days yet.

`@saasicat/core` gains `withWithdrawalDays`, `FEATURE_WITHDRAWAL_MOMENTS` and
the type `TenantFeatureWithdrawalAsRead`; `FeatureWithdrawalMark`,
`TenantFeatureWithdrawal`, `TenantFeatureWithdrawalLine` and `EndAtOncePreview`
carry the days, and `WithdrawnFeature`, what `withdrawnFeaturesOf` returns,
stays without them.

---
'@saasicat/core': major
'@saasicat/nest': major
'@saasicat/ui-vue': major
---

Compare a plan version on every quota it carries, not on three keys by name

`classifyPlanDiff` compared `maxUsers`, `maxVehicles` and `maxStorageGb` and
nothing else, so a quota an installation defines for itself — NotesApp's
`notesMax`, a club's `members` — could be halved and published without the
confirmation a regression asks for. Which quotas exist comes from
`@DefinesQuota` in the app, so a fixed set here could only ever have covered the
ones the platform happened to have heard of. Add-on versions were already
compared on every quota they carry; plans now use the same comparison, `-1`
(unlimited) included. `SC-PLAN-025` moves from decided to delivered.

**Breaking.** `PlanVersionFields` now takes `quotas: Record<QuotaKey, number>`
in place of the three flat fields, and a quota change is reported as
`quotas.<key>` rather than `maxUsers`. Anything reading a `VersionChange.field`
— a label map, a report over stored `publishedChanges` — follows the same
rename. Rows published before this change keep the field names they were
written with.

Two admin-UI label maps follow: `regressionFields.quotasLowered` /
`quotasRaised` and `diffFields.maxUsers` / `maxStorageGb` are replaced by one
`quota` entry that takes the key. The platform names no quota, because the
installation owns the vocabulary; an app that wants its own word for one passes
it through the `fieldLabels` prop.

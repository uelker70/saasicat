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

A quota key is compared by own-property lookup, so an installation may name one
`constructor` or `toString` without the side that lacks it answering from
`Object.prototype`. Add-on version diffs, which already used this comparison,
gain the same correction.

**A quota value is a number, and the boundary now says so.** `@IsObject()`
validated the container and nothing in it, so `{ "users": "100" }` reached the
service, the repository and the JSON column. Two things went wrong downstream
and the second is the worse one: the comparison read `"50"` against `"100"` as
_strings_, so halving an allowance classified as an improvement and published
with nothing asked — and "unlimited" is `=== -1` at every enforcement site,
which `"-1"` is not, so an unlimited quota written as a string became
`max !== -1` and `used + delta > "-1"`: every request refused, for a tenant who
had bought no limit at all.

Plan and add-on version drafts now insist on an integer of at least -1 per key,
which is the shape `plan-catalog.schema.json` has always stated for the same
field — the catalogue-import path was validated by that schema all along, and
the admin route is catching up. The comparison reads both sides as numbers
regardless, because rows written before this exist; a value that cannot be read
as one counts as a regression, since not knowing is not evidence of an
improvement.

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

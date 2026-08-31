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
as a finite one counts as a regression, since not knowing is not evidence of an
improvement — and `"1e999"` reads as `Infinity`, which would otherwise beat
every allowance there is.

**And the defence never saw a string, because three mappers disagreed.** The
same decision — how a quota is read out of a JSON column — was written three
times: `plan-mapping` dropped every non-number, so a legacy `{"users": "100"}`
reached the version diff as _absent_ and replacing it with 50 read as 0 → 50, an
improvement; the adapters' `toQuotaMap` cast the column straight through, so the
same value reached enforcement as a string, and `"-1"` turned an unlimited quota
into a limit that refused everything; `subscription-contract-mapping` dropped it
too, taking an allowance somebody had bought out of their own contract.

`readQuotaValue` and `readQuotaRecord` in `@saasicat/core` are that reading,
once. A number written as a string is that number. What cannot be read as a
finite number keeps its key: dropping it would make the quota _absent_, and
absent means undeclared, which `enforceLimit` answers with a 500 — so a corrupt
row would have refused the tenant every operation on that dimension. A quota
that is declared and cannot be read is the other requirement, `SC-ENTL-010`:
it blocks nobody. Wherever a quota is computed with it becomes `-1`, the value
every enforcement site short-circuits on and one that survives the JSON column
a contract snapshot lives in; in the catalogue row it stays `NaN`, because only
the diff has to tell "the plan did not have this quota" from "the plan had
something nobody can read", and it reports the value that was actually there.

The cost is stated rather than hidden: a corrupt value reads as unlimited to
anything that renders it. What `SC-ENTL-010` also asks for — the gap reported
for review — is not done, because these functions are framework-free and have
nowhere to log.

The change record keeps the value as it stood rather than the reading.
`publishedChanges` is persisted to a JSON column, and neither `NaN` nor
`Infinity` is a JSON value: normalising into the record would have written
`null` on exactly the rows where an operator has to see what was really there.

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

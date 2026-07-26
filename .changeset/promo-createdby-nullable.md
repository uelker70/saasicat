---
'@saasicat/spec': patch
'@saasicat/cli': patch
---

Align `PromoCode.createdById` with the types the platform already publishes, and
stop `schema check` from flagging consumers that are stricter than the spec.

The prisma fragment declared `createdById String` (NOT NULL) while
`PromoCodeRecord.createdById` in `@saasicat/types` is `string | null` — the read
contract explicitly allows a missing creator, so the column must too. Creation
is unaffected: `CreatePromoCodeData.createdById` stays `string`. The fragment
and the generated `reference-schema.postgres.sql` now say `String?` / `TEXT`.

`schema check` treated nullability as a symmetric mismatch, which made this a
zero-sum change: relaxing the spec simply moved the warning from vereinsfux to
notesapp and autohauspro. Only one direction can actually break — a consumer
column that is nullable where the spec is not, because platform code reads it
with the spec's non-null type and a NULL row reaches it as `null`. The reverse
is a deliberate tightening by the consumer, and if the platform ever wrote NULL
there the insert would fail loudly rather than silently. Only the breaking
direction is reported now.

---
'@saasicat/cli': minor
---

`schema check` now compares block-level attributes too — `@@index`, `@@unique`
and `@@map`.

Comparing only fields and enum values left a whole class of divergence
invisible. vereinsfux was missing eight indexes the spec declares and
autohauspro two, while all three consumers reported "no drift". Worse, the same
blind spot hid a missing `@@unique`: nothing in the field comparison can tell
you that a constraint the platform relies on was never created.

The two kinds are not treated alike. A missing index costs query time but
breaks nothing, so it is reported as information and does not fail the run. A
missing `@@unique` or a diverging `@@map` does fail: the platform relies on the
constraint holding, and on finding the table under its canonical name.

Attribute options and whitespace are normalised, so `@@index([a,b], map: "x")`
matches `@@index([a, b])`. Indexes a consumer adds on top are never reported —
same rule as for fields.

Note the remaining gap: constraints Prisma's DSL cannot express at all (the
partial unique indexes in `sql/constraints.postgres.sql`) still live outside
any schema comparison. vereinsfux had never applied them.

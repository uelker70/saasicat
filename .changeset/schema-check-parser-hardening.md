---
'@saasicat/cli': patch
---

Fix four parsing defects in `schema check`, all found by review of the previous
two releases. Each let the check pass on a schema it should have flagged, or
skip a declaration it should have compared.

**Commented-out block attributes counted as present.** A consumer with
`// @@unique([tenantId])` or `// @@map("subscriptions")` was reported `ok`,
defeating exactly the correctness gate those attributes exist for. Attribute
parsing now strips comments first. This is not hypothetical: vereinsfux turned
out never to have applied its canonical partial unique indexes at all.

**A brace inside a string literal closed the model early.** `@default("}")`
counted as structure, so every field below it looked missing — or spec fields
after it were silently dropped and the check returned a false success. Brace
counting now blanks string contents. `stripLineComment` became string-aware in
the same move, so `@default("http://x")` no longer loses everything after `//`.

**Indexed field arguments were skipped entirely.** In
`@@index([title(sort: Desc)])` the capture stopped at the argument's closing
paren before reaching `]`, so the index never entered the parsed set and a
consumer lacking it got no finding. The field list is now matched to its
closing bracket.

**Unknown fragment selectors were silently discarded.** `--fragments=01,99`
checked only fragment 01 and exited 0, so a typo in a CI gate left part of the
schema surface unverified. Unknown selectors now fail with the available list.

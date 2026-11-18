---
'@saasicat/cli': minor
---

`schema migrate` carries every constraint, and names one it leaves out

`saasicat schema migrate` took every word after "on" in the constraints file,
comments included, for a table, and left six constraints out of the migration
on a schema that has every table — among them two money checks and the one
payment confirmation per gateway session. It now reads the table from each
statement, and prints a line for each block it leaves out, with its constraint
and the missing table (`SC-OPS-017`). A database set up through
`schema migrate` alone applies `constraints.postgres.sql` once; see
"`schema migrate` carries every constraint" in `docs/guides/upgrade-to-1.0.md`.

- **Breaking:** `constraintsFor` is `selectConstraints` and returns
  `{ applicable, leftOut }` rather than the SQL alone. `readStatements` is new,
  and `tablesAddressedBy` reads statements rather than words.

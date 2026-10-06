---
'@saasicat/spec': patch
---

The order of corrections is numbered whole, or not at all

`1.0-a-correction-carries-its-order.postgres.sql` numbers the corrections
already recorded in the order they were listed. Run by a role that a row-level
policy keeps some of them from — a forced policy binds the table's owner too —
it renumbered only the rows it could read and update and then set the numbering
to continue after them: the others kept the order the table stores them in, and
the next correction could collide with a number already taken. The file now
counts the rows it renumbered against those the new column numbered, and stops
before anything changes where it renumbered fewer, naming both counts; the
numbering is no longer reset, since adding the column already left it after
every row. Run it as a role that may read and update every row; a policy lifted
by a setting is lifted for it the same way. A database where the file ran
already is not touched again.

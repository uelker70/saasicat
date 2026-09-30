---
'@saasicat/spec': patch
---

Find the quoted version of a scheduled change on a schema that stores plans by
row id

`1.0-a-scheduled-change-keeps-its-quoted-version.postgres.sql` backfills the
version a change already scheduled to another plan binds. It found the plan
only by its key in `plan_versions."planId"`, so on an installation whose
Prisma adapter runs with `planBinding: { mode: 'normalized-plan-id' }` — where
that column holds the plan's row id — it bound nothing, and such a change took
the version in effect when it came due. It now also finds the plan through the
row of `plans` that carries the key. The file still runs twice without effect
on the second run.

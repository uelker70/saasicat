---
'@saasicat/spec': patch
---

The backfill of `1.0-a-scheduled-change-keeps-its-quoted-version.postgres.sql`
gives a change scheduled before it the version on sale, as the platform reads
it

A change scheduled to another plan before the file ran is given the version the
platform would sell that day. The file chose it by other rules: it took a
version whose last day (`validUntil`) had passed, left out a superseded one
whose last day still ran, preferred the higher number to the later start, and
read the dates in the session's time zone rather than as the UTC they are
stored in. It now chooses as `buildActivePlanVersionWhere` does. The file
chooses only in the run that adds the column, so a database that ran an earlier
copy keeps what that run chose.

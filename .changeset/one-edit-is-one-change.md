---
'@saasicat/core': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
---

One edit is recorded once, however many replicas start on it

Several replicas of one installation starting together after one edit of
`config/saas.yaml` each read the same record, each found the same difference,
and each wrote a change row and mailed every address under
`notifications.settingsChanged` — three replicas and two addresses made six
mails for one edit, and three changes for an operator to acknowledge one by
one. Now only the start that replaces the record writes the change and tells
people; the others read again, find the record already saying what they run,
and say nothing. A replica running a different file than the one that won has
a difference of its own and records it.

**The port's two writes are guarded.** `AppliedSettingsPort`, new in the 1.0
line, changes shape for that:

- `writeApplied(record, expectedFingerprint)` replaces the record only while it
  still carries the fingerprint the caller read — `null` where it read no
  record — and answers whether it did.
- `recordChange(change, record, expectedFingerprint)` appends the change and
  replaces the record it supersedes in one transaction, both or neither, under
  the same guard; it answers the stored change, or `null` where another start
  got there first.

`prismaPersistence()` and `drizzlePersistence()` implement both, and the
executable contract in `@saasicat/persistence-testing` holds every adapter to
them, concurrently and against a real database.

**The list of changes reads in the order the record moved.** `settings_changes`
gains `seq`, numbered by the database at the write that records each change,
and `listChanges` orders by it instead of by `noticedAt`. That moment is the
recording start's own clock — the recorder now reads it right before writing
rather than when the start began — but a start delayed between its clock and
its write could still land after another's move and be listed before it. The
number is assigned inside the write, under the row lock the guard takes, so it
cannot. Run `sql/1.0-a-settings-change-carries-its-order.postgres.sql` once,
the same way as the other files; it is safe to run again, numbers rows recorded
before it in the order they were listed until now, and does nothing on a
database created from the reference schema. On the Prisma path, `SettingsChange`
gains `seq Int @unique @default(autoincrement())` — copy it from
`prisma-fragments/12-applied-settings.prisma`. An `AppliedSettingsPort` you
wrote yourself against an earlier candidate needs the two signatures; nothing
else moves, and no migration is involved — the guard uses the columns the
tables already have.

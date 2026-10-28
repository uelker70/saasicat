---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/nest': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/cli': minor
'@saasicat/ui-vue': minor
---

A returning customer's subscriber is joined into the one it had

A customer whose tenant was deleted and who signs up again is joined by the
operator: in the record of the new subscriber, "Belongs to an earlier
subscriber …" finds the earlier one among those without a live tenant, shows
both side by side with what moves and what the earlier record takes, and joins
them behind the second factor once a reason is given and both are declared one
legal entity, held to the preview shown — or with `saasicat subscribers join
--from <customer number> --into <customer number> --reason … [--apply]`.
Everything the new subscriber holds moves to the earlier one in one
transaction; its record stays, names where everything went and takes no
change, and a join is not undone.

It is off until `SaaSiCatModule.forRoot({ subscriberJoins: true })` turns it
on. `SubscriberJoin` is a new model in `prisma-fragments/27-subscriber-join.prisma`,
with two relation fields on `Subscriber`. Run
`sql/1.0-a-subscriber-is-joined.postgres.sql` after `db push`: its triggers
refuse a row for a joined subscriber, so a job that read the subscriber before
a join writes at the earlier one when it runs again. With joins on, the start is
refused where a table a join moves is missing — name it in `notAdopted` — or
lacks its trigger. A CLI registers
`SubscriberJoinCliFlow`, `SubscribersCommands` and `SubscribersJoinCommand`;
`FakeSubscriberJoinRepository` joins in tests without a database.

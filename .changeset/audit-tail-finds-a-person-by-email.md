---
'@saasicat/core': patch
'@saasicat/cli': major
'@saasicat/adapter-drizzle': patch
'@saasicat/adapter-prisma': patch
'@saasicat/persistence-testing': minor
---

Find a person's audit entries by their e-mail, through both adapters

`<app> audit tail --actor <email>` passed the address on as an actor tag, and
every tag the platform writes reads `<source>:<email>:<context>`, so the filter
never matched anything. And the two shipped adapters read a pattern
differently: Prisma took a star at either end, Drizzle only at the end and with
case (`SC-AUD-018`).

- `AuditQuery.actorTag` states its grammar: a tag, matched exactly, or a
  pattern with a star at its start, its end or both, matched without regard to
  case, everything between the stars literal. The Drizzle adapter reads it as
  the Prisma adapter already did.
- `audit tail --actor` turns an address into `*:<email>:*`, so it lists that
  person's entries from the web and the command line alike. A value with a
  colon or a star is passed on as the tag or pattern it already is.
- **If you implement `AuditQueryPort` yourself**, it now receives that
  pattern: read the grammar on `AuditQuery.actorTag`, or `--actor` answers
  with an empty list — no error, since nothing matched. An adapter that
  searched the address as a substring, or knew only a trailing star, finds
  nothing for `*:<email>:*`. The shipped adapters read it, and the persistence
  contract now holds any adapter to it.
- The Prisma adapter matches `%` and `_` in a searched value literally. Prisma
  hands `contains`, `startsWith` and `endsWith` to `LIKE` as they are, so an
  underscore stood for any character: a search for the promo code `BLACK_25`
  also found `BLACKX25`, and the tenant, user and audit searches likewise. The
  Drizzle adapter already escaped them.
- The persistence contract searches a promo code with an underscore and an
  audit log by a pattern, for any adapter.
- The flow no longer promises a cap of 500 on `--limit`: the adapter sets it,
  and the shipped ones cap at 200.

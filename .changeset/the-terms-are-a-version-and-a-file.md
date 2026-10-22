---
'@saasicat/core': minor
'@saasicat/spec': minor
'@saasicat/adapter-prisma': minor
'@saasicat/adapter-drizzle': minor
'@saasicat/persistence-testing': minor
'@saasicat/nest': minor
---

The operator's terms are a version and a file

`config/saas.yaml#terms` names a version of the operator's terms and the PDF
that holds them, beside the file or by an absolute path. The start archives
each version it has not archived before, byte for byte with its checksum, and
refuses another file under a version already archived: a changed file is a new
version (`SC-CFG-038`). It also refuses a version no file could be called, a
file it cannot read or that is no PDF, a relative file where the settings were
handed in as code, terms without an archive and an archive whose triggers are
missing or disabled, and contracts do not start where nothing archives the
terms the file names. Every contract records the version and the days of
notice the subscriber agreed to, and when (`termsVersion`, `agreedAt` on
`SubscriptionContractRecord`): a change they make reads the file at that
moment; a change they schedule records them when they schedule it
(`pendingAgreement`), and the contract written when it takes effect records
those unless they agreed to newer terms since; a successor the operator or
the platform writes without them — a feature withdrawal's reductions, a
refresh, a retirement's move at its date — keeps them from the contract it
replaces (`SC-CANC-026`, superseding `SC-CANC-025`). `writeSuccessor` takes
`agreement`, a retirement's contract terms say whether they are its `move` or
the `switch` the subscriber took (`kind`), and a booking records what was
agreed for a contract written for it later. Invoicing requires the block.

Fragment 25 adds `TermsVersion` (`terms_versions`); fragment 08 gives the
contract `termsVersion` and `agreedAt`, fragments 01 and 11 the subscription
and the booking the columns of what was agreed.
`1.0-the-terms-are-a-version-and-a-file.postgres.sql` adds them before
`db push` — `agreedAt` filled with the moment each contract was written —,
with the triggers that refuse every update, delete and truncate of an archived
version.
Both adapters ship the archive as `core.termsArchive` (`PrismaTermsArchive`,
`DrizzleTermsArchive`), `adapters.termsArchive` takes one of an application's
own, and `notAdopted: ['TermsVersion']` leaves it out. `TermsArchivePort`,
`toArchivedTermsVersion`, `termsVersionChanged` and the refusal code
`TERMS_VERSION_CHANGED` come from `@saasicat/core`; the persistence contract
covers the archive as `termsArchive`.

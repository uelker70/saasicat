---
title: What is kept, and what is never written down
---

Two questions a tenant and an operator both eventually ask: what does this system record about me,
and what does it throw away. The requirements below answer them, and one of them constrains
SaaSiCat itself — a record that survives has to be one that is safe to keep.

### SC-PRIV-001 — Nothing that could cause harm is written to a log

🟢 🔒 No passwords, tokens, keys, session secrets or complete sensitive payloads, and no personal data
beyond what a diagnosis needs. A production failure needs context, not secrets.

_Source:_ internal engineering guidelines

### SC-PRIV-002 — A network address is recorded as a fingerprint, never in the clear

🟢 🔒 In the anti-abuse trail and in the record of registration steps alike.

_Source:_ release 1.0.0-rc.7

### SC-PRIV-003 — Passwords and verification codes cannot be read back out of storage

🟢 🔒

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-helpers.test.js`
    - verifyOtpCode returns false on a broken hash (no throw)
- `packages/nest/tests/registration-service.test.js`
    - start() stores OTP only as a hash, never in plaintext

<!-- END proof -->

### SC-PRIV-004 — The record of a registration carries no address, password or code in the clear

🟢 🔒 Recording the address would make the trail itself a way to find out who has an account.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - start() stores OTP only as a hash, never in plaintext

<!-- END proof -->

### SC-PRIV-005 — Payment details are kept masked

🟢 🔒 SaaSiCat records how a tenant would pay, not enough to pay as them.

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-006 — A record that history depends on is retired, not deleted

🟢 🔒 Plans, add-ons, promotional codes and catalogue entries are withdrawn from use and kept. Only
an unpublished draft is removed outright.

_Source:_ `docs/explanation/data-model.md`

### SC-PRIV-007 — An abandoned registration is removed rather than kept in a reduced form

🟢 🔒 The address it holds is exactly the thing that has to become usable again.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - runCleanup() deletes expired, leaves active alone
    - runCleanup() frees the email again after deletion → repeated start() works

<!-- END proof -->

### SC-PRIV-008 — Failed attempts are part of the record, not only successful ones

🟢 🔒

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/registration-service.test.js`
    - audit: verifyOtp success → OTP_VERIFIED, wrong → OTP_VERIFY_FAILED

<!-- END proof -->

### SC-PRIV-009 — A migration that would destroy data stops and says what it found

🟢 🔒 Rather than merging rows nobody meant to merge, or discarding them. Which of two colliding
records survives is not a decision a migration takes on its own.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a migration that would merge rows stops instead
        - two project keys stop it, and the message names them
        - and the installation is exactly as it was afterwards
        - and the installation is exactly as it was afterwards
    - a line item learns the money it was booked with
        - a contract with ${what} stops the migration and is named

<!-- END proof -->

### SC-PRIV-010 — History is not rewritten

🟢 🔒 A period a tenant was already billed for is left as it stands, even by a correction that would
otherwise be tidier. Rewriting it changes what the record says happened.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-PRIV-011 — Contracts, invoices and payments outlive the tenant they were for

🟢 💰 They belong to the subscriber (`SC-SCOPE-012`) and are kept
for as long as they have to be.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/what-the-subscriber-keeps-outlives-the-deletion.test.js`
    - the subscriber's commercial record
        - outlives the tenant's deletion whole, and the charge not yet invoiced is invoiced after it
        - taken by a store stops the deletion there: the record stays open and halted, naming the
          store, and no later store erases
        - taken by a store whose count after it failed is laid at that store on the next run, before
          any later store erases
        - that grew while a store erased lost nothing, and the deletion closes
- `examples/notesapp/tests/integration/a-tenants-erasure-leaves-its-subscribers-record.integration.test.mjs`
    - the notes app's eraser on PostgreSQL
        - takes the tenant's own rows and leaves the subscriber's commercial record whole, and what
          the platform keeps of the tenant

<!-- END proof -->

### SC-PRIV-012 — A record kept for tax purposes is not deleted automatically

🟢 💰 A retention period in configuration can be set too short,
and the first one runs out years from now. Removing records whose period has passed is a later
and deliberate addition.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/what-the-subscriber-keeps-outlives-the-deletion.test.js`
    - the subscriber's commercial record
        - outlives the tenant's deletion whole, and the charge not yet invoiced is invoiced after it
        - taken by a store stops the deletion there: the record stays open and halted, naming the
          store, and no later store erases
        - taken by a store whose count after it failed is laid at that store on the next run, before
          any later store erases
        - that grew while a store erased lost nothing, and the deletion closes
- `examples/notesapp/tests/integration/a-tenants-erasure-leaves-its-subscribers-record.integration.test.mjs`
    - the notes app's eraser on PostgreSQL
        - takes the tenant's own rows and leaves the subscriber's commercial record whole, and what
          the platform keeps of the tenant

<!-- END proof -->

### SC-PRIV-013 — A subscriber with no live tenant and no claim left keeps only what its documents need

🟡 _(Decided, not yet delivered.)_ 🔒 Its tenant was its only live one (`SC-SCOPE-012`), and every
contract and invoice carries its own copy of the subscriber's details (`SC-PRIC-092`,
`SC-AUD-020`). A claim is left while a charge is not yet on an invoice, while an invoice is open,
while a credit is still to be refunded, and until the latest end of the reversal period among all
its payments (`SC-PRIC-084`); until then the contact data and the gateway reference needed to
collect or refund stay. How long a payment can be reversed depends on how it was made and is not
something SaaSiCat can observe, so the installation names that period in `config/saas.yaml`,
counted from each payment. Each payment keeps the end of its period as the setting stood when the
payment was recorded, so shortening the period later never brings an earlier payment's end forward,
and a newer payment with a shorter period never ends the claim an older one still holds. The
reading errs towards keeping the data a little longer rather than losing a claim.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-014 — A tenant is deleted through the application, which first names what to keep

🔵 _(Superseded on 2026-11-15 by `SC-PRIV-022`.)_ 🔒 The application erases all of the tenant's data
and files, records it locks against deletion included, and provides a full export. Beforehand it
reports what the tenant has to keep for obligations of its own, such as receipts under a retention
period, and that report does not stop the deletion: keeping those records is the tenant's
obligation, not the operator's, and the read-only period of `SC-CANC-027` is the time to take them
along. SaaSiCat decides when, asks for confirmation and records that it happened. Deleting a single
record inside the application, such as a member or a case, still honours the application's own
locks.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-015 — A tenant's deletion leaves a record with the subscriber that names no person

🔵 _(Superseded on 2026-11-15 by `SC-PRIV-023`.)_ 🔒 What was deleted, when and by which run, as
counts per category. A deletion earlier than announced also records the announced date, the reason
and that the operator confirmed it against that date (`SC-ADM-020`). It is kept with the subscriber
rather than in the audit log, which an installation may prune.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-016 — Erasing a tenant's data or files is refused unless exactly one tenant is named

🟢 🔒 An empty or missing tenant identifier would reach every
tenant at once, so such a request is refused before anything is erased.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-tenant-is-erased-only-when-one-tenant-is-named.test.js`
    - a tenant identifier is checked as it was given
        - nothing given is missing
        - a value that is not text is named as such, a list of one tenant included
        - empty text and spaces alone are blank
        - a space or a line break around it is refused, not trimmed
        - the longest identifier is allowed, one character more is not
        - a slug or a uuid names one tenant
    - an eraser asks first
        - one tenant named passes
        - anything else is refused, naming the problem
        - the refusal does not repeat the value, which may be anything
- `packages/nest/tests/a-tenant-is-deleted-on-its-day-and-only-there.test.js`
    - the tenant a store is asked about
        - is never one an end names as nobody
- `examples/notesapp/tests/the-notes-app-erases-one-tenant.test.mjs`
    - the notes app's eraser
        - refuses what does not name exactly one tenant before it asks the database anything

<!-- END proof -->

### SC-PRIV-017 — A tenant is deleted only after its full export was offered in the read-only period

🔵 _(Superseded on 2026-11-15 by `SC-PRIV-024`.)_ 🔒 The offer, the reminders sent and the tenant's
acknowledgement, where it gave one, are part of the deletion record (`SC-PRIV-015`). An
acknowledgement that never comes does not stop the deletion.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-018 — A tenant's deletion can safely run again, and is done only once every store confirms

🟢 🔒 Data and files live in different stores, and a call can time
out after it has already erased. Each eraser treats what is already gone as done, a run that stops
partway is reported and repeated rather than left half-finished, and the deletion record
(`SC-PRIV-023`) is written only when every store has confirmed. Once a run has begun the tenant is
being deleted: nobody writes to it any more, the operator acting as the tenant included
(`SC-ADM-060`). Before its first destructive call, each store counts what it is about to erase and
keeps those counts with the run, so a call whose answer was lost, and a repeat that finds the store
already empty, still leave the counts that were erased rather than a record that nothing was
deleted.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-tenant-is-deleted-on-its-day-and-only-there.test.js`
    - the beginning of a deletion
        - records the deletion and holds the tenant back in one transaction: where it fails, neither
          stands
        - keeps what the tenant was told to keep, and stops at lines nobody can read
    - the stores
        - all count before the first erases, each in the order the application lists them
        - a count nobody can read stops the deletion before anything is erased
        - listed otherwise than when the deletion began, stop it before anything more is erased
    - a deletion broken off
        - goes on after the store that confirmed, and keeps the code of the failure, never its
          message
        - by a store that did not answer in time is left to it until the claim goes stale; the
          counts it took first stand
    - two instances at once
        - begin a deletion once, and each store is asked once
        - going on with a deletion begun before, one claims it and the other leaves it
- `packages/nest/tests/an-operator-joins-a-returning-customer.test.js`
    - a join while a deletion of either subscriber's tenants is under way
        - is refused into a subscriber whose tenant is being deleted, naming it, and nothing moves
        - is refused from a subscriber whose tenant is being deleted, naming it
        - is made once that deletion has closed
        - is made where only an unrelated subscriber's tenant is being deleted
- `examples/notesapp/tests/integration/a-tenants-erasure-leaves-its-subscribers-record.integration.test.mjs`
    - the notes app's eraser on PostgreSQL
        - erasing the tenant again is done, and changes nothing
- `examples/notesapp/tests/the-notes-app-erases-one-tenant.test.mjs`
    - the notes app's eraser
        - erasing a tenant already gone is done, and erases nothing of another

<!-- END proof -->

### SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export

🔵 _(Superseded on 2026-11-14 by `SC-PRIV-020`.)_ 🔒 From the moment the end of the tenant's
subscription is recorded (`SC-CANC-027`) until its data is deleted, a user holding the tenant's
administrator role downloads the tenant's full export as one file, which the application produces.
The tenant's other users cannot, since it holds every user's data. Before the end is recorded the
export is refused with a stable code, as the tenant still works in the application; after the
deletion day it is still offered while the data is there. A suspension or a deletion under way
refuses it as it refuses every request of the tenant's users (`SC-ADM-055`). The tenant is always
the session's, never one the request names. The application is asked on every download; the download
is recorded only once the application has handed the whole file over, and the file is sent only once
its download is recorded, so a file never leaves without its record and a record never claims a file
the application did not produce. Every download is a record of its own, with its moment and who took
it, kept beside the end; it is the tenant's acknowledgement that `SC-PRIV-017` names. A download
shows that the file was produced for that request; it cannot show that it was saved.

_Source:_ #337 (decided 2026-11-12)

### SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application

🟢 🔒 From the moment the end of the tenant's subscription is recorded (`SC-CANC-027`) until its data
is deleted, a user holding the tenant's administrator role is offered the tenant's full export as
one file, which the application produces. The tenant's other users are not, since it holds every
user's data, and neither is the operator acting as the tenant. Before the end is recorded the export
is not offered, as the tenant still works in the application; after the deletion day it is still
offered while the data is there. The tenant is always the session's, never one the request names.
The application either hands the file over for the platform to serve, or declares that it delivers
the export from a download of its own; it does not start with neither, nor with a declaration naming
anybody else as delivering it. Where the platform serves the file, a suspension or a deletion under
way refuses the download as it refuses every request of the tenant's users (`SC-ADM-060`), and any
other download outside these rules is refused with a stable code; the application is asked on every
download, the download is recorded only once the application has handed the whole file over, and the
file is sent only once its download is recorded, so a file never leaves without its record and a
record never claims a file the application did not produce. Where the application delivers it, who
may download it from its own route is the application's to decide, and the platform records a
download once the application reports that the whole file has gone out, at least one byte of it —
only for the session's tenant, taken by its administrator rather than the operator, with an end
recorded; otherwise it records nothing and says why with a stable code. There the file has left
before its record is written, so a download that broke off, or that the application does not report,
leaves no record. On either path a `HEAD`, which carries no file, is answered `405` and records
nothing. Either way every download recorded is a record of its own, with its moment, who took it and
its size, kept beside the end; it is the tenant's acknowledgement that `SC-PRIV-024` names. A
download shows that the file was produced or delivered for that request; it cannot show that it was
saved.

_Source:_ #337 (decided 2026-11-12) · #512 (decided 2026-11-14)

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-ended-subscription-names-its-days-and-offers-the-export.test.js`
    - the export is offered to the administrator only where the route serves it
        - read-only for an ended subscription whose end is recorded, the export wired: offered
        - to a user who is not the administrator: not offered
        - where the application wired no export: not offered
        - while the end is not recorded yet: not offered
        - a suspended tenant whose subscription ended: not offered
        - a tenant being deleted whose subscription ended: not offered
        - read-only for an unpaid invoice alone: not offered
        - an open tenant: not offered
        - asked without saying who asks, as an untyped caller may: not offered
- `packages/nest/tests/a-route-that-costs-money-asks-for-the-role.test.js`
    - who of a tenant may do what
        - the reads that are the administrator's alone are these, and ask for the role
- `packages/nest/tests/a-tenant-takes-its-export-before-its-deletion.test.js`
    - a tenant's administrator takes its export once its subscription ended
        - the file goes out as the application produced it, under its name
        - the download is recorded beside the end, with the moment, who took it and the bytes handed
          out
        - and written to the audit log under a key the audit page can name
        - the route records who took it from the session
        - a session without an email is still recorded by the user it names, whatever context the
          request claims
        - every download is a record of its own, the oldest first
        - the application is asked again for every download
        - is still offered after the deletion day, while the data is there
        - of two ended subscriptions, the latest end is the one the download is recorded for
    - the export is offered only once an end is recorded
        - a tenant that is open is refused, and the application is not asked
        - a tenant read-only for an unpaid invoice, with no end, is refused
        - a tenant held for an ended subscription whose end is not recorded yet is refused
        - an end whose reason was lifted offers nothing any more
    - a file never leaves without its record, and no record claims a file not produced
        - an application that fails is refused with a stable code, and nothing is recorded
        - an answer whose content is not bytes is refused, and nothing is recorded
        - a media type a header cannot carry is refused before anything is recorded
        - an empty file is refused, and nothing is recorded
        - an answer without a file name is refused, and nothing is recorded
        - a download that cannot be recorded sends no file and writes no audit entry
        - an audit log that fails leaves the download recorded and sent
    - one export of a tenant at a time, since each is held in memory as a whole
        - a second request while the first is produced is refused, and the application is asked once
        - once the first has arrived, the next request is served
        - where the application failed, the next request is served
        - where the download could not be recorded, the next request is served
        - another tenant is not held up by one being produced
    - the export is the session's tenant's alone
        - a request naming another tenant anywhere but its session is answered for its session
        - another tenant's end, recorded under a reason of its own, offers its own export only
        - a reason naming another tenant's subscription offers nothing
    - the file name the application gives is not trusted for the header
        - path separators, quotes and line breaks are replaced
        - an empty name is offered as the export
    - where the route is checked
        - it carries no access mark, so a read-only tenant reads it as a GET
        - it stays behind the tenant's guard and the administrator's
        - a user of the tenant without the role is refused, and its administrator let through
        - a tenant read-only because its subscription ended is let through
        - a tenant whose subscription ended and that is suspended is refused
        - a tenant whose subscription ended and that is being deleted is refused
    - the operator does not take the export in the tenant’s name
        - a user holding SUPER_ADMIN is refused with a code of its own, and nothing is asked or
          recorded
        - the operator the application's check let through as acting is refused, whatever role the
          session carries
        - a request the application checked as a tenant user’s is not taken for the operator’s
        - is not offered the export on either read of the tenant’s state
    - the state a user reads offers the export exactly where the route serves it
        - for the administrator, offered where it is served and nowhere else
        - for a user without the role, offered nowhere, and served nowhere
        - for the operator, offered nowhere, and served nowhere
        - where the application wired no export, nothing is offered
- `packages/nest/tests/subscription-ends-are-wired-where-tenants-are-served.test.js`
    - the application's export, which the ends cannot start without
        - serving tenants without it, the start is refused with one sentence naming the option, the
          port and why
        - given, nothing is refused
        - without tenant billing, it is not asked for
        - tenant billing wired by hand with the ends and without it does not start, naming the
          option and the port
        - given, the route is mounted and the export is asked through the port given
    - the declaration that the application delivers the export itself
        - stands in for the port: nothing is refused
        - naming anybody else as delivering it, the start is refused in one sentence naming the
          application
        - tenant billing wired by hand with a declaration naming anybody else does not start
        - the refusal of a start with neither names both ways
        - mounts no route of the platform for the export, and asks no port
        - hands the application the service it records each delivered download through
        - where the platform serves the export, its route is mounted and no such service handed out
        - tenant billing wired by hand with it mounts no route for the export either
- `packages/nest/tests/the-application-delivers-the-tenants-export.test.js`
    - the application records a download it delivered in full
        - it is recorded beside the end, with the moment, who took it from the session and the bytes
          that went out
        - the application is answered the download as recorded
        - and written to the audit log as a download the platform serves is
        - every delivery is a record of its own, the oldest first
        - is still recorded after the deletion day, while the data is there
        - of two ended subscriptions, the latest end is the one the download is recorded for
        - one at a time is the application’s to keep: two deliveries reported together are both
          recorded
        - an audit log that fails leaves the download recorded, and says so in the server log
        - a download that cannot be recorded is thrown as it is, and writes no audit entry
    - a delivery is recorded only once an end is recorded
        - ${state}: refused as not offered, and nothing is recorded or audited
        - an end whose reason was lifted records nothing any more
    - only a whole file is recorded
        - one byte is a file, and is recorded
        - ${what}: refused as an export not delivered, and nothing is recorded or audited
    - a HEAD carries no file, so it records nothing
        - ${method}: refused as the method the export is not taken by, and nothing is recorded or
          audited
    - the operator does not record a download in the tenant’s name
        - a user holding SUPER_ADMIN is refused with a code of its own, and nothing is recorded
        - the operator the application's check let through as acting is refused, whatever role the
          session carries
        - a request the application checked as a tenant user’s is recorded as the administrator’s
        - a user of the tenant without the administrator’s role is refused, and nothing is recorded
        - a session that names no user is refused, and nothing is recorded
    - the state a user reads says who delivers the export
        - to the administrator, the application, where it delivers the export
        - to the administrator, the platform, where it serves the export
        - to anybody who is not offered the export, nobody
        - while no end is recorded, nobody
    - the download recorded is the session's tenant's alone
        - a request naming another tenant anywhere but its session is answered for its session
        - another tenant's end, recorded under a reason of its own, records its own download only
- `packages/nest/tests/the-compiler-asks-for-what-serving-tenants-needs.test.js`
    - the options of an application that serves tenants
        - compile with the declaration that the application delivers the export itself
        - do not compile with a declaration naming anybody else as delivering it
- `packages/nest/tests/the-days-and-downloads-of-an-ended-subscription-are-shown.test.js`
    - the operator's page names the day and every download of the export
        - the deletion day, and every download with its moment and who took it, the oldest first
- `packages/nest/tests/the-tenants-export-over-http.test.js`
    - the tenant's export over HTTP, on Express and on Fastify
        - a GET hands the administrator the file and records the download
        - the operator the application says is acting as the tenant is refused, and nothing is asked
          or recorded
        - a user holding SUPER_ADMIN is refused as the operator
        - a HEAD is refused with the method the route allows, and asks and records nothing
- `packages/ui-vue-tenant/tests/component/a-held-back-tenant-reads-why.test.ts`
    - the tenant's export, taken from the banner
        - is offered to its administrator as a button named for what it downloads, reached from the
          keyboard
        - downloads the export and saves it under the name the server offers
        - is busy while it downloads, and cannot be pressed a second time meanwhile
        - is offered to nobody the server does not say may take it
        - refused, says why in the sentence each refusal is worded with, never its code
        - refused in German, says why in German
        - failed without a code the platform words, says the export did not arrive, and leaves the
          banner as it was
        - refused with a code the platform does not word, says the export did not arrive rather than
          the code
        - where the connection breaks, says the export did not arrive
    - the tenant's export, where the application delivers it
        - the button starts the application's own download, and nothing is loaded from the platform
        - is busy while the application's download runs, and cannot be pressed a second time
          meanwhile
        - where the application's download fails, says the export did not arrive and leaves the
          banner as it was
        - where the platform serves it, the button downloads it as before and the application's
          action is not started
        - where nothing listens, says so in the console once the export is offered, before anybody
          presses
        - where nothing listens, pressing says the export did not arrive, and nothing is loaded from
          the platform
        - where the export is not offered, nothing is said in the console, whether or not anything
          listens

<!-- END proof -->

### SC-PRIV-021 — A tenant is deleted only in the database its installation marked as its own

🟢 🔒 The database carries the identifier of its installation,
which the operator sets with a command, and every process names the identifier of the
environment it runs in. A deletion runs only where both name the same; otherwise nothing is
deleted, and the run says why. Until the operator has marked the database nothing is deleted at
all, and a tenant whose deletion day has come is shown as due and halted, which is how an
operator sees what would be deleted before the terms name the deletion period. Marking the
database, and marking it again with another identifier as after restoring a backup into another
environment, takes the second factor. The brake protects against a process meant for another
environment; one whose environment was copied from production, identifier included, passes it.

_Source:_ #338 (decided 2026-11-14 and 2026-11-15)

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/default-doctor-checks.test.js`
    - InstallationMarkDoctorCheck
        - is silent where the database is this environment’s
        - warns, before the first mark, that nothing is deleted until the operator marks it
        - is an error where the database is another installation’s, naming both
        - is an error where the mark cannot be read, and fine where nothing is deleted at all
- `packages/cli/tests/installation-cli-flow.test.js`
    - installation mark
        - asks for the second factor and the confirmation before it writes, and marks as the
          operator
        - writes nothing where ${step} refuses
        - refuses another installation’s mark without --replace, naming it, and replaces it with
        - refuses an identifier that is not this environment’s, and writes nothing
        - prints what marking came to
    - installation status
        - says for each verdict what it means and what changes it, as text and as JSON
- `packages/core/tests/an-installation-deletes-only-in-the-database-it-marked.test.js`
    - an installation identifier is checked as it was given
        - nothing given is missing
        - a value that is not text is named as such
        - empty text and spaces alone are blank
        - a space before or after is refused, not trimmed
        - the longest identifier is allowed, one character more is not
        - letters, digits, dots, dashes and underscores make an identifier
        - it begins with a letter or a digit
        - a path separator is no part of one
        - a long run of text ending in a bad character is answered at once
    - a deletion compares the environment with the mark
        - a database nobody marked is unmarked, and names what this environment expects
        - the same identifier matches
        - another case is another identifier, never the same one
        - a backup of production restored into staging differs
- `packages/core/tests/where-a-tenants-deletion-stands.test.js`
    - what holds a due deletion before it begins
        - an unmarked database holds it on its day, naming what the process expects
        - a database marked for another installation names both identifiers
        - before its day it is scheduled, with what would hold it were the day today
        - before its day with nothing that would hold it, the forecast is empty
        - every reason that holds is named, in the order the run asks them
        - ${name} is held by that alone
        - a marked database, a subscriber and no contract past the end leave it due
        - the mark alone holds where the database is not the installation’s, and names why
- `packages/nest/tests/a-held-deletion-is-said-once-a-day.test.js`
    - the installation mark that holds every due deletion
        - is said once on the deletion day, however often the run comes, and again on the next
        - is said again at once where another tenant falls due
        - is said again at once where the database is marked as another installation
- `packages/nest/tests/a-tenant-is-deleted-on-its-day-and-only-there.test.js`
    - the installation mark in front of the run
        - over a database unmarked, or marked as another installation, nothing begins and the log
          says so once for the run
        - a mark changed while a deletion is under way stops it before the next store, and the
          record stays open
- `packages/nest/tests/the-compiler-asks-for-what-serving-tenants-needs.test.js`
    - the options of an application that serves tenants
        - compile with the environment's identifier passed as the environment gives it
        - do not compile with the ends named and the deletion left out
        - do not compile with the deletion named and the environment's identifier left out
- `packages/nest/tests/the-installation-is-marked-before-anything-is-deleted.test.js`
    - the identifier of this process's environment, which a start serving tenants names
        - left out, not given or not an identifier, the start is refused, naming the option, its
          source and the command
        - says what is wrong with the value, without repeating it
        - an identifier is enough, as long as the rules allow
        - with nowhere to read the mark from, the start is refused, naming both places
        - the bundle's store of the mark, or one named, is enough
        - without tenant billing, nothing is asked for
        - the start itself is refused, not a later run
        - tenant billing wired by hand is refused the same way
        - a start that serves tenants compares with the identifier its environment names
    - whether the database belongs to this environment
        - unmarked until the operator marks it
        - matches once it is marked as this environment
        - differs where production's backup was restored into staging
    - marking the database
        - is refused with any identifier but this environment's, and writes nothing
        - writes the mark once, with when and by whom, and audits it once
        - marking twice at once in one process lands once and audits once
        - marked as another installation, it is refused and names the mark that stands
        - another installation marking between the read and the write is refused the same way
        - the mark stands where the audit log cannot be written, and the failure is logged
    - replacing the mark, as after restoring production's backup into staging
        - replaces it with this environment, and audits the old and the new
        - with nothing to replace, it marks
        - where this environment stands already, it changes nothing
        - a mark changed between the read and the write is refused, and nothing is written
        - a mark set by another installation between the read and the write is refused as moved
- `packages/nest/tests/where-a-deletion-stands-is-read-naming-no-person.test.js`
    - a deletion not begun, on the tenant page
        - over an unmarked database on its day is halted, naming the identifier to mark it with;
          marked, it is due
        - before its day is scheduled, with what would hold it were the day today
        - is halted while a contract concluded since runs past the end, and due where the contract
          ended with it
        - is halted where the tenant has no subscriber to keep the record with
        - names every reason that holds it, in the order the run asks them
        - is nothing to come where the reason holding the tenant was lifted, though its end stands
        - is nothing to come for a tenant whose subscription never ended
- `packages/ui-vue/tests/component/tenant-detail-shows-where-its-deletion-stands.test.ts`
    - the tenant detail shows where the tenant's deletion stands
        - $label: its pill and what it says
        - a retried deletion names its last failure, by store, step and code
        - a halted deletion lists every reason, in the order the run asks them
        - before its day, it says what would hold the deletion were the day today
        - a begun deletion leads into the record kept with its subscriber
        - a deletion not yet begun has no record to lead into
        - a tenant with no deletion to come shows no section
        - a tenant the application does not have shows no section
        - a read that fails says so, and asks again on retry
        - without the capability, nothing is asked and no section is shown
- `packages/ui-vue/tests/where-a-deletion-stands-is-worded.test.js`
    - every reason that holds a deletion, with what it names
        - a deletion due on an unmarked database says how to mark it, with its identifier
        - a database marked as another installation names both identifiers
        - three reasons at once are three sentences, in the order the run asks them
        - before its day, what would hold it is the forecast, said as one
        - a store that took part of the commercial record is named, with each part before and after
        - a commercial record found short with no store to lay it at says so without one
        - in German, the same reason in German, with the same identifier

<!-- END proof -->

### SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep

🟢 🔒 The application erases all of the tenant's data and files, store
by store, records it locks against deletion included, and provides a full export (`SC-PRIV-020`).
Beforehand it reports what the tenant has to keep for obligations of its own, such as receipts under
a retention period, as lines of a category and a count. Those lines appear in the banner of the
read-only period, in every reminder (`SC-CANC-022`) and in the deletion record (`SC-PRIV-023`), and
they do not stop the deletion: keeping those records is the tenant's obligation, not the operator's,
and the read-only period of `SC-CANC-027` is the time to take them along. SaaSiCat decides when and
records that it happened. The confirmation it deletes on is the installation's, given once by
marking its database (`SC-PRIV-021`), not one asked for each deletion. Deleting a single record
inside the application, such as a member or a case, still honours the application's own locks.

_Source:_ #338 (decided 2026-11-15)

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-tenant-is-deleted-on-its-day-and-only-there.test.js`
    - a tenant whose subscription ended
        - is not deleted in the last second before its day in the installation zone, and is on the
          first
        - is deleted where its day passed already
        - is not deleted where the reason holding it to reading was lifted, though its end stands
        - is held back from then on, even from the operator acting as it and only reading
        - is not deleted by an earlier end, its day past, while a later reason names an end not
          recorded yet
        - held by two ends of one moment, is deleted on the later of their days
        - has nothing erased and no record begun where it has no subscriber to keep the record with
    - the beginning of a deletion
        - keeps what the tenant was told to keep, and stops at lines nobody can read
    - the quarter-hourly run
        - sets the deletions off without waiting for them, and starts no second beside the first
- `packages/nest/tests/a-tenant-is-reminded-before-its-deletion.test.js`
    - what a reminder tells the tenant to keep
        - carries the application's lines, to the port and into the record
        - a report that fails fails the reminder of its end alone, and the next run sends it with
          the lines
        - lines the report gets wrong fail the reminder as a report that fails does
        - a report that does not answer fails the reminder in time, so the run that records the ends
          is not held up
- `packages/nest/tests/a-tenant-reads-what-it-keeps.test.js`
    - a tenant in its read-only period reads what it keeps
        - every user of the tenant is answered the lines as the application reported them
        - the tenant is the session’s: one named by the request is neither asked for nor answered
        - an open tenant keeps nothing to be told of, and the application is not asked
        - a tenant read-only for an unpaid invoice alone is not being deleted: nothing, unasked
        - an ended subscription beside an unpaid invoice is asked for
    - what the application fails to answer is shown as no lines, and said in the log
        - a report that throws: no lines, a sentence with its code, nothing of what it threw
        - lines without their English label: no lines, a sentence with the problem, no label
        - an answer that is no list at all: no lines
        - a report that never answers is given up on after the time allowed
        - the time allowed is short enough for a page to wait on
    - where the route is checked
        - it carries no access mark: the tenant’s state decides, as for every read
        - it stays behind the tenant’s guard, and asks no role of the tenant’s user
        - a read-only tenant’s user without any role is let through
        - a suspended tenant is refused, as on every route but its state
        - a tenant being deleted is refused
    - where the route is mounted
        - beside the deletion of tenants
        - nowhere a subscription’s end is kept
- `packages/nest/tests/subscription-ends-are-wired-where-tenants-are-served.test.js`
    - the application's stores a tenant is erased from, which the ends cannot start without
        - wired, nothing is refused, and the run is there to be called
        - erasers missing, none listed, one named twice or named with no stable key: the start is
          refused in one sentence naming the option and the requirement
        - erasers a factory builds are held to the same once built, before anything runs
        - without the report of what a tenant keeps, the start is refused, naming the option and the
          port
        - with nowhere to record a deletion or to find its subscriber, the start is refused; the
          bundle's, or one named, is enough
        - tenant billing wired by hand is refused the same way, naming each option it lacks
- `packages/nest/tests/the-compiler-asks-for-what-serving-tenants-needs.test.js`
    - the options of an application that serves tenants
        - do not compile with the deletion named and the erasers or the report of what is kept left
          out
- `packages/ui-vue/tests/what-a-tenant-keeps-is-read-once-in-its-language.test.js`
    - what the tenant keeps, as a page reads it
        - read once an end holds the tenant to reading, under the prefix the app gives
        - read as soon as the state, read later, says so
        - not read again when the page reads the state again
        - not read again when the state leaves the read-only period and comes back to it
        - a tenant ${why} is not asked, and shows no lines
        - lines read show no more once the tenant is suspended
        - where the route is not there, nothing to show and no error
        - where the application gave nothing to show, nothing to show and no error
        - an answer that is not lines is an error, and nothing is shown
        - a failure of the server is an error, and nothing is shown
    - a line's label, in the reader's language
        - ${locale}: ${why}
- `packages/ui-vue-tenant/tests/component/a-held-back-tenant-reads-why.test.ts`
    - the banner of a tenant whose subscription ended, on what it keeps itself
        - tells every user, not only its administrator, what to keep and how many, beneath the
          reasons
        - to a German reader, in the application's German words where it gives them, else in
          English, and counts as German writes them
        - shows no list where the application %s
        - while suspended, neither asks nor shows what it keeps
        - where it cannot be read, leaves the banner as it was and says nothing of the failure
        - is asked once for the page, not with each read of the state every minute

<!-- END proof -->

### SC-PRIV-023 — A tenant's deletion leaves a record with the subscriber that names no person

🟡 _(Decided, not yet delivered.)_ 🔒 What was deleted, when and by which run, as counts per
category. A deletion earlier than announced also records the announced date, the reason and that
the operator confirmed it against that date (`SC-ADM-020`). Where the tenant was suspended at some
moment between the end of its subscription and the beginning of its deletion, so that its export
could not be taken then, the record says so. It is kept with the subscriber rather than in the audit
log, which an installation may prune. The rows the platform keeps of the tenant beyond its deletion
— its holds, its end and the day it was told, the downloads of its export and the notices it was
sent — keep the role somebody acted in, the tenant's administrator, the operator or a run, rather
than who it was; a hold keeps its kind and its days but not its note, which is free text and may
name anybody; and a notice keeps how many it went to rather than to whom.

_Source:_ #338 (decided 2026-11-15)

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-deletion-record-is-read-back-as-it-was-kept.test.js`
    - a deletion record read back
        - has its stores in their order, each with its own counts, and the kept lines apart
        - reads a day kept as text as the same day
        - a failure written is read back as it was
        - the one halt a record keeps is read back as it was
        - the count rows to write say what each is
        - refuses a value the platform never writes, naming its row
- `packages/core/tests/a-person-becomes-the-role-it-acted-in.test.js`
    - a person in a row that outlives its tenant becomes the role it acted in
        - a run is the run, whichever column it wrote
        - the command line is the operator, whichever column it wrote
        - a suspension recorded from the web is the operator
        - any other hold recorded from the web is the run
        - a hold lifted from the web is the operator
        - an ended subscription’s reason lifted from the web is the tenant administrator, who came
          back
        - an end recorded from the web is the tenant administrator
        - an announcement from the web is the tenant administrator
        - a download from the web is the tenant administrator
        - a row that names a role already, as the rows of a deleted tenant do, keeps it, whichever
          column
        - a tag of no known kind is read as the web, never kept
- `packages/nest/tests/a-deleted-tenant-leaves-roles-not-persons.test.js`
    - the rows a deleted tenant leaves
        - name the role somebody acted in, and a notice how many it went to, never who
        - keep who acted where the transaction that closes the deletion fails, and the next run
          closes it
        - lift every reason still open but the deletion’s own, as the run, once the deletion closes
        - keep the operator’s lift of a suspension that lands while the deletion closes, as the
          operator’s
- `packages/nest/tests/a-tenant-takes-its-export-before-its-deletion.test.js`
    - an export whose deletion begins while it is produced is not handed out
        - a deletion ${closed ? 'closed' : 'under way'} by the time the file arrives: refused,
          nothing recorded or audited
        - another tenant's export produced at the same time is handed out and recorded
- `packages/nest/tests/the-application-delivers-the-tenants-export.test.js`
    - a delivery reported once the deletion has begun is not recorded
        - a deletion under way, however long ago the download started: refused, nothing recorded or
          audited
        - another tenant's delivery is still recorded
- `packages/nest/tests/where-a-deletion-stands-is-read-naming-no-person.test.js`
    - a deletion done, on the record of its subscriber
        - is read once the application has no tenant any more, with every store, the commercial
          record, the reminders and the downloads, naming no person
        - of a tenant that came back once, keeps the reminders and downloads of the end it was
          deleted for
        - names no person while the deletion is under way and the rows still name them
        - counts a reminder that reached nobody as 0, and one not delivered as not delivered
        - says on both pages that a suspension kept the export from being taken between the end and
          the deletion

<!-- END proof -->

### SC-PRIV-024 — A tenant is deleted only after its full export was offered in the read-only period

🟢 🔒 The offer, the reminders sent and the tenant's
acknowledgement, where it gave one, are part of the deletion record (`SC-PRIV-023`). An
acknowledgement that never comes does not stop the deletion. The export counts as offered from the
moment the end is recorded even where a suspension kept the tenant from taking it, and the record
says that the tenant was suspended.

_Source:_ #338 (decided 2026-11-15)

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-tenant-comes-back-before-its-deletion-day.test.js`
    - a download of the export belongs to the end it was offered for
        - taken the moment the end was recorded, it is that end’s
        - taken a moment before, it is not: an earlier end of the subscription offered it
- `packages/nest/tests/a-tenant-is-deleted-on-its-day-and-only-there.test.js`
    - the record of when the export could be taken
        - says a suspension kept it from being taken where one held after the end
        - deletes the tenant on its day though nobody ever took its export
        - says none did where the suspension was lifted before the end
- `packages/nest/tests/the-days-and-downloads-of-an-ended-subscription-are-shown.test.js`
    - the operator's page names the day and every download of the export
        - a tenant that came back and ended again is listed the downloads of this end alone
- `packages/nest/tests/where-a-deletion-stands-is-read-naming-no-person.test.js`
    - a deletion done, on the record of its subscriber
        - is read once the application has no tenant any more, with every store, the commercial
          record, the reminders and the downloads, naming no person
        - of a tenant that came back once, keeps the reminders and downloads of the end it was
          deleted for
        - names no person while the deletion is under way and the rows still name them
        - counts a reminder that reached nobody as 0, and one not delivered as not delivered
        - says on both pages that a suspension kept the export from being taken between the end and
          the deletion
        - of a tenant that came back once, keeps the reminders and downloads of the end it was
          deleted for
- `packages/ui-vue/tests/component/subscriber-record-shows-its-deletions.test.ts`
    - the subscriber's record shows its tenants' deletions
        - a tenant the application no longer has, named by its id, with all that is recorded of its
          deletion
        - a deletion just begun says what is not there yet
        - a deletion halted for a lost commercial record marks the part that fell
        - a deletion still to come shows where it stands, and no record yet
        - two tenants, each with its own deletion, in the order the server gives them
        - a subscriber with no deletion says so
        - a read that fails says so, and asks again on retry
        - a subscriber the platform does not have shows nothing to delete
        - without the capability, nothing is asked and no section is shown
- `packages/ui-vue/tests/where-a-deletion-stands-is-worded.test.js`
    - what the subscriber's record keeps of a deletion
        - the export: offered since when, whether a suspension kept it, and whether the day was told
        - each store in the order it erases in, with its counts as kept and what it has done
        - the commercial record, every part before and after, the ones that fell marked
        - a commercial record not counted yet has every part, and no number
        - each reminder with its lead time, how many it reached, or that it reached nobody or was
          not delivered
        - each download with its moment, its size and the role that took it, in words

<!-- END proof -->

### SC-PRIV-025 — No invoice or suspension reaches a tenant being deleted; its close lifts the rest

🟢 🔒 Once a tenant's deletion has begun, nothing changes its reasons but the deletion itself, with
one exception, so that none is left standing, or naming a person, once the tenant is gone. An
invoice records or lifts no reason on it any more, neither through the quarter-hourly run nor
through the payment that settles it (`SC-PRIC-104`), and the operator cannot suspend it: the
deletion already holds it back more strictly than either (`SC-ADM-060`). The exception is lifting a
suspension that stands, which stays the operator's (`SC-ADM-005`), and whose record names a role
once the tenant is gone (`SC-PRIV-023`). When the deletion closes, every reason of the tenant still
open — an unpaid invoice, a suspension, the end of its subscription — is lifted by the run, and only
the deletion's own stays open, since nobody acts in a deleted tenant again. Nothing is recorded
against the tenant afterwards while its subscriber still owes: the claim itself stays in the
subscriber's ledger (`SC-PRIV-013`) and is settled without a tenant (`SC-ADM-060`).

_Source:_ #338 (decided 2026-11-16)

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-unpaid-on-its-due-date-holds-its-tenant-back.test.js`
    - the reasons a run records and lifts
        - a tenant whose deletion has begun gets no reason and loses none; another tenant does
        - a deletion reason lifted holds the rule back no more
- `packages/nest/tests/a-deleted-tenant-leaves-roles-not-persons.test.js`
    - the rows a deleted tenant leaves
        - lift every reason still open but the deletion’s own, as the run, once the deletion closes
        - keep the operator’s lift of a suspension that lands while the deletion closes, as the
          operator’s
- `packages/nest/tests/admin-resources.test.js`
    - a suspension is the platform's record
        - suspending a tenant whose deletion has begun is refused, and nothing is recorded or
          audited
        - another tenant's deletion leaves a suspension of this one as it is
- `packages/nest/tests/an-invoice-unpaid-on-its-due-date-holds-its-tenant-back.test.js`
    - a tenant whose deletion has begun
        - gets no reason from an invoice unpaid on its due date; another tenant does
        - keeps the reason it had when its invoice is paid: the run lifts none, the close does
        - keeps the reason it had when the payment that settles its invoice comes in

<!-- END proof -->

### SC-PRIV-026 — A tenant is not deleted while a contract of it runs past the end that made it due

🟢 🔒 A tenant whose subscription ended is due for deletion on the day its end names, and its
deletion does not begin while a contract of the tenant is in force at that end or begins after it —
one concluded since, as a checkout offer may be for a tenant whose earlier contract has ended
(`SC-MKT-028`). The run holds it, writes nothing and says so in the server log, and asks again on
its next run; a contract that ended before that end, or with it, does not hold it. It holds beside
the new subscription that lifts the deletion day (`SC-CANC-034`), so that no tenant under contract
is erased for an end its contracts have moved past. Where it stops: the contracts are read just
before the deletion begins rather than in the transaction that begins it, so one concluded in that
moment is not seen, and a deletion already begun is not stopped by one concluded afterwards.

_Source:_ #338 (decided 2026-11-16)

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-held-deletion-is-said-once-a-day.test.js`
    - a tenant held by a contract that runs past its end
        - is held without the application being asked what the tenant keeps
        - is held where the contract was concluded while the application answered what it keeps
        - is said once on the deletion day and again on the next
- `packages/nest/tests/a-tenant-is-deleted-on-its-day-and-only-there.test.js`
    - a tenant whose contract runs past the end that made it due
        - a contract concluded after the end, in force on the deletion day, holds the deletion:
          nothing written, nothing erased, the log says so
        - a contract beginning only after the deletion day holds it too
        - the contract the end closed, ending with it, does not hold it
        - a contract that ended before the end does not hold it
        - another tenant's contract holds only that tenant
    - a tenant held by two ends, with a contract concluded between them
        - the contract ended ${how}: deleted on the later end's day, not before, and recorded
          against it

<!-- END proof -->

### SC-PRIV-027 — The deletion of a tenant ends its subscriber's link to it

🟢 🔒 The transaction that closes a tenant's deletion also ends the link between the tenant and its
subscriber, so that the subscriber keeps the tenant as one it was linked to, with when the link
ended, and has no live tenant from then on: the operator finds it among the subscribers without one
(`SC-ADM-036`), and a returning customer's new subscriber can be joined into it (`SC-ADM-027`). A
deletion that does not close leaves the link open, and another tenant's link stays as it is.

_Source:_ #338 (decided 2026-11-16)

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-deleted-tenant-leaves-roles-not-persons.test.js`
    - the subscriber's link to a deleted tenant
        - is closed by the transaction that closes the deletion, and only by it
- `packages/nest/tests/an-operator-joins-a-returning-customer.test.js`
    - a returning customer whose earlier tenant the platform deleted
        - leaves the subscriber it had without a live tenant, its link ended as the deletion closed
        - is joined into the subscriber it had

<!-- END proof -->

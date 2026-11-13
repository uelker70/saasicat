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

🟡 _(Decided, not yet delivered.)_ 💰 They belong to the subscriber (`SC-SCOPE-012`) and are kept
for as long as they have to be.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-012 — A record kept for tax purposes is not deleted automatically

🟡 _(Decided, not yet delivered.)_ 💰 A retention period in configuration can be set too short,
and the first one runs out years from now. Removing records whose period has passed is a later
and deliberate addition.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

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

🟡 _(Decided, not yet delivered.)_ 🔒 The application erases all of the tenant's data and files,
records it locks against deletion included, and provides a full export. Beforehand it reports
what the tenant has to keep for obligations of its own, such as receipts under a retention
period, and that report does not stop the deletion: keeping those records is the tenant's
obligation, not the operator's, and the read-only period of `SC-CANC-027` is the time to take
them along. SaaSiCat decides when, asks for confirmation and records that it happened. Deleting
a single record inside the application, such as a member or a case, still honours the
application's own locks.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-015 — A tenant's deletion leaves a record with the subscriber that names no person

🟡 _(Decided, not yet delivered.)_ 🔒 What was deleted, when and by which run, as counts per
category. A deletion earlier than announced also records the announced date, the reason and that
the operator confirmed it against that date (`SC-ADM-020`). It is kept with the subscriber rather
than in the audit log, which an installation may prune.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-016 — Erasing a tenant's data or files is refused unless exactly one tenant is named

🟡 _(Decided, not yet delivered.)_ 🔒 An empty or missing tenant identifier would reach every
tenant at once, so such a request is refused before anything is erased.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-017 — A tenant is deleted only after its full export was offered in the read-only period

🟡 _(Decided, not yet delivered.)_ 🔒 The offer, the reminders sent and the tenant's
acknowledgement, where it gave one, are part of the deletion record (`SC-PRIV-015`). An
acknowledgement that never comes does not stop the deletion.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-018 — A tenant's deletion can safely run again, and is done only once every store confirms

🟡 _(Decided, not yet delivered.)_ 🔒 Data and files live in different stores, and a call can time
out after it has already erased. Each eraser treats what is already gone as done, a run that stops
partway is reported and repeated rather than left half-finished, and the deletion record
(`SC-PRIV-015`) is written only when every store has confirmed. Once a run has begun the tenant is
being deleted: nobody writes to it any more, the operator acting as the tenant included
(`SC-ADM-055`). Before its first destructive call, each store counts what it is about to erase and
keeps those counts with the run, so a call whose answer was lost, and a repeat that finds the store
already empty, still leave the counts that were erased rather than a record that nothing was
deleted.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export

🟢 🔒 From the moment the end of the tenant's subscription is recorded (`SC-CANC-027`) until its data
is deleted, a user holding the tenant's administrator role downloads the tenant's full export as
one file, which the application produces. The tenant's other users cannot, since it holds every
user's data. Before the end is recorded the export is refused with a stable code, as the tenant
still works in the application; after the deletion day it is still offered while the data is there.
A suspension or a deletion under way refuses it as it refuses every request of the tenant's users
(`SC-ADM-055`). The tenant is always the session's, never one the request names. The application is
asked on every download; the download is recorded only once the application has handed the whole
file over, and the file is sent only once its download is recorded, so a file never leaves without
its record and a record never claims a file the application did not produce. Every download is a
record of its own, with its moment and who took it, kept beside the end; it is the tenant's
acknowledgement that `SC-PRIV-017` names. A download shows that the file was produced for that
request; it cannot show that it was saved.

_Source:_ #337 (decided 2026-11-12)

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
        - the download is recorded beside the end, with the moment and who took it
        - and written to the audit log under a key the audit page can name
        - the route records who took it from the session
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
        - an answer without a file name is refused, and nothing is recorded
        - a download that cannot be recorded sends no file and writes no audit entry
        - an audit log that fails leaves the download recorded and sent
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
        - a user of the tenant without the role is refused; the administrator and the operator
          acting are let through
        - a tenant read-only because its subscription ended is let through
        - a tenant whose subscription ended and that is suspended is refused
        - a tenant whose subscription ended and that is being deleted is refused
    - the state a user reads offers the export exactly where the route serves it
        - for the administrator, offered where it is served and nowhere else
        - for a user without the role, offered nowhere, and served nowhere
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
- `packages/nest/tests/the-days-and-downloads-of-an-ended-subscription-are-shown.test.js`
    - the operator's page names the day and every download of the export
        - the deletion day, and every download with its moment and who took it, the oldest first
- `packages/nest/tests/the-tenants-export-over-http.test.js`
    - the tenant's export over HTTP, on Express and on Fastify
        - a GET hands the administrator the file and records the download
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

<!-- END proof -->

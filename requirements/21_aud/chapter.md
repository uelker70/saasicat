---
title: Answering the question afterwards
---

Prices change, plans are republished, entitlements move. This chapter is about being able to
answer, months later, what was true at a particular moment and who made it so. It is what turns a
dispute into a lookup.

### SC-AUD-001 — Every administrative action records who did it, from where, and when

🟢 Including actions taken from a command line rather than a browser, in a form that says which of
the two it was.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-published-version-names-who-published-it.test.js`
    - publishing and ending a version names who did it
        - a plan version records its publisher and is audited with what was chosen
        - an add-on version records its publisher and is audited with what was chosen
        - ending a plan version is audited with the day it ends and the end it replaced
        - a refused publish or end leaves no audit entry behind
        - without a signed-in user the publisher stays empty rather than invented
    - a draft names who started it
        - for a plan
        - for an add-on
- `packages/nest/tests/admin-guards.test.js`
    - AdminAuditService
        - actorTag formats source:email:context
        - log() writes through and appends the actor tag to changes
        - fromWebRequest builds AdminActor with source=web
        - fromWebRequest falls back to "unknown" when there is no session
        - fromCli builds AdminActor with source=cli + hostname
- `packages/nest/tests/onboarding-subscription.test.js`
    - onboarding writes an audit log with COMPLETE_ONBOARDING_SUBSCRIPTION
- `packages/nest/tests/registration-service.test.js`
    - audit: start() logs REGISTRATION_STARTED + pendingId
    - audit: verifyOtp success → OTP_VERIFIED, wrong → OTP_VERIFY_FAILED

<!-- END proof -->

### SC-AUD-002 — An action that belongs to no single tenant says so

🟢 Platform-wide acts are distinguishable from acts on one tenant, rather than looking like an entry
whose tenant went missing. An action nobody triggered — a scheduled job — is likewise
distinguishable from one a person took.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/prisma-adapters.test.js`
    - PrismaAuditAdapter
        - write maps actor to userId + actorTag on audit_logs

<!-- END proof -->

### SC-AUD-021 — An audit entry names the tenant it concerns, so the tenant's deletion takes it along

🟢 🔒 An entry names the tenant where somebody acts in it — on the tenant's own routes, its users
changing the plan, ending an add-on, taking the export or paying what is open, the operator giving
it a new administrator with `user reassign-admin` — and where what the tenant runs on changes,
whoever changed it: its subscription, its add-ons, its contract, its suspension. It names none where
it records an act on no tenant; none where the operator acts on a person found by e-mail address — a
password reset, a deactivation — because one person may belong to several tenants; and none where
the operator or a run acts on the subscriber's commercial record, which outlives the tenant: a
payment recorded, an invoice held, a credit paid out, an archived file checked or held, a collection
run. The application's data eraser finds a tenant's entries by that name and deletes them before the
tenant (`SC-PRIV-022`). An entry written before SaaSiCat named the tenant on entries keeps naming
none.

_Source:_ #519 · #338 (decided 2026-11-15)

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/the-user-command-names-the-tenant-it-acts-in.test.js`
    - the user command names a tenant only where it acts in one
        - a new administrator given to a tenant names the tenant the application answered with
        - a password reset of a person found by e-mail address names no tenant
        - a deactivation of a person found by e-mail address names no tenant
- `packages/nest/tests/a-cancellation-announces-the-day-its-data-is-deleted.test.js`
    - confirming a cancellation
        - records exactly the days the account stated, and the answer, the audit entry and the
          account afterwards repeat them
- `packages/nest/tests/a-newer-add-on-version-is-taken.test.js`
    - POST billing/subscription-bundles/:id/version-offer/accept
        - switches the caller’s own tenant and records who did it
- `packages/nest/tests/a-retirement-takes-effect.test.js`
    - the move at the date
        - records the move under the platform job, naming both versions
- `packages/nest/tests/a-subscriber-ends-at-once.test.js`
    - the day its data is deleted on, where a subscription ends at once
        - through the route, where the day cannot be recorded, the end stands, answers, is audited
          without a day, credits and tells
- `packages/nest/tests/a-subscription-change-is-recorded-before-and-after.test.js`
    - a plan change is recorded with what it was before and after
        - the entry names the plan and cycle on both sides of the change
- `packages/nest/tests/a-switch-taken-for-a-term-end-is-made.test.js`
    - a switch whose moment has come
        - moves the booking, writes the contract that marks it, clears the schedule and records it
- `packages/nest/tests/a-tenant-takes-its-export-before-its-deletion.test.js`
    - a tenant's administrator takes its export once its subscription ended
        - and written to the audit log under a key the audit page can name
- `packages/nest/tests/a-trial-that-ran-out-is-ended-by-the-application.test.js`
    - a trial that ran out, ended by the application
        - lets the entitlements, the contract and the audit log know, as a cancellation does
- `packages/nest/tests/admin-resources.test.js`
    - a suspension is the platform's record
        - suspending records the reason with its note and who, audits it, and answers the state
        - reactivating lifts the suspension and leaves an overdue invoice holding
- `packages/nest/tests/an-add-on-booking-moves-at-its-date.test.js`
    - the move at the date
        - moves each booking onto the replacement, keeping its period, terms and rhythm
- `packages/nest/tests/an-audit-entry-names-the-tenant-it-concerns.test.js`
    - an audit entry names the tenant it concerns
        - the audit service hands the tenant to the log, and names none where it was given none
        - a download the application delivered names its tenant, although it is recorded across
          tenants
        - an operator's act on a promotional code names no tenant
        - collecting what a subscriber owes › the run names no tenant on what it plans and tries
        - collecting what a subscriber owes › a tenant's user paying now names the tenant on each
          step of the collection it starts
        - collecting what a subscriber owes › a tenant's user paying now by direct debit names the
          tenant on its announcement
        - collecting what a subscriber owes › the payment it brings is recorded with the subscriber,
          and names no tenant
- `packages/nest/tests/an-operator-carries-a-vocabulary-into-running-contracts.test.js`
    - carrying the features over
        - the refresh is in the audit log, with the contract it replaced
- `packages/nest/tests/an-operator-exports-the-invoice-register.test.js`
    - the audit log
        - records who took which archive: the months, the moment, the language, what it holds and
          its SHA-256
- `packages/nest/tests/the-application-delivers-the-tenants-export.test.js`
    - the application records a download it delivered in full
        - and written to the audit log as a download the platform serves is

<!-- END proof -->

### SC-AUD-003 — Every change to a subscription is recorded with what it was before and after

🟢 Plan changes, scheduled changes, activations, accepted versions and cancellations.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscription-change-is-recorded-before-and-after.test.js`
    - a plan change is recorded with what it was before and after
        - the entry names the plan and cycle on both sides of the change
        - the before is read from the subscription, not echoed from the request

<!-- END proof -->

### SC-AUD-004 — A failure to record something never blocks the act itself

🟢 A gap in the record is better than an outage for the tenant. Where no recording is configured at
all, the platform skips it rather than failing — a deliberate degradation for the smallest
installations.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-maintenance-window-is-announced-locked-and-ended.test.js`
    - what the operator does not wait on
        - an audit log that cannot be written does not undo the lock

<!-- END proof -->

### SC-AUD-005 — Serious actions are marked as serious

🟢 Suspending a tenant, acting as one, publishing or ending a plan version, cancelling a
subscription, deactivating a user and handing over administrative rights are all findable as the
weighty acts they are.

_Source:_ release 1.0.0-rc.6

### SC-AUD-006 — The record can be searched by who, what, which object and since when

🟢 And it hands back a bounded page rather than everything at once.

_Source:_ release 1.0.0-rc.0

### SC-AUD-007 — What a customer bought is frozen at purchase

🟢 A plan change creates a new agreement and keeps the old one. Nothing rewrites what was agreed.

_Source:_ `docs/explanation/concepts.md` · `docs/explanation/capability-to-contract.md`

### SC-AUD-008 — A published version stays readable for as long as anything references it

🟢 So the question "what did this customer actually buy" always has an answer.

_Source:_ `docs/explanation/data-model.md`

### SC-AUD-009 — What a promotional code promised at redemption stays with the redemption

🟢

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/promo-service.test.js`
    - what a code promised at redemption stays with the redemption
        - the redemption records the terms, not a pointer to them
        - and editing the code afterwards does not rewrite them

<!-- END proof -->

### SC-AUD-010 — A charge names where it came from and which agreement line it belongs to

🟡 _(Decided, not yet delivered.)_ Activation, renewal, a prorated plan change, an add-on booking, a
credit — so an account can be walked back to what was agreed.

_Source:_ #214

### SC-AUD-011 — A charge carries the period it belongs to

🟢 Which charges belong on one invoice has to be derivable, and a set
of individually booked amounts with no grouping leaves that to guesswork.

_Source:_ #214

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - every period is charged, at the price in force when it starts
        - the first period is the activation, the next a renewal, each for its own period
        - periods a renewal skipped are charged one by one, from where the account left off
        - a later price applies to the periods that start under it, not before
        - a window opened a moment before its contract is still charged under it
        - a subscription older than its first charge starts with a renewal, not an activation
        - a yearly plan is charged its yearly line
        - a contract line in another rhythm prices nothing

<!-- END proof -->

### SC-AUD-017 — Every charge names the contract line it came from

🟢 So the account can always be walked back to what was agreed, which is what an invoice line will
be traced through (`SC-AUD-013`).

_Source:_ #214 · #276

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - every period is charged, at the price in force when it starts
        - the first period is the activation, the next a renewal, each for its own period
        - periods a renewal skipped are charged one by one, from where the account left off
        - a later price applies to the periods that start under it, not before
        - a window opened a moment before its contract is still charged under it
        - a subscription older than its first charge starts with a renewal, not an activation
        - a yearly plan is charged its yearly line
        - a contract line in another rhythm prices nothing

<!-- END proof -->

### SC-AUD-012 — A contract carries both parties as they were when it was concluded

🔵 _(Superseded on 2026-10-18 by `SC-AUD-020`.)_
💰 The subscriber, and the issuer as `config/saas.yaml` named
it that day, so the contract still says which legal entity was the counterparty after either
changes and after the tenant is gone. A copy made while an existing contract is migrated says
so, and is never presented as what was true at conclusion. Either party may have changed since the
contract was concluded, which the migration cannot see, so the operator confirms each migrated copy
against the contract as concluded, correcting it where it differs, before that contract is
invoiced; until then it is not.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-AUD-020 — A contract is concluded with both parties, and carries them as they were that day

🟢 💰 The subscriber, and the issuer as `config/saas.yaml` named it that day, so the contract still
says which legal entity was the counterparty after either changes and after the tenant is gone. An
installation that concludes contracts does not start while the file names no issuer, so no contract
is concluded with nobody on the operator's side. A copy the migration to subscribers made of an
existing contract's parties says so and is never presented as what was true at conclusion. Neither
such a contract nor one concluded before a contract needed an issuer is invoiced: nothing SaaSiCat
holds says who its parties were that day, so its charges stay held (`SC-PRIC-097`). Every
successor frozen afresh, such as after a change of plan or of its billing rhythm, an add-on booked
or ended, a move to another version, or a refresh in full, copies both parties as they stand that
day, and that one is invoiced. One that only carries the contract forward, a refresh of its
features (`SC-ENTL-023`) or a feature withdrawn (`SC-SUB-042`), keeps its copy as it was.

_Source:_ #334 · #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-issuer-is-the-same-entity-or-another-one.test.js`
    - the copy a contract takes of the issuer
        - carries the same three fields the start compares, and the address beside them
        - never loses all three because one of them could not be read
        - does not carry the declaration, which is about the change and not the party
- `packages/nest/tests/a-contract-is-concluded-with-its-subscriber.test.js`
    - a contract names the parties it is concluded with
        - it copies the tenant's subscriber and the issuer the configuration names
        - where the configuration names no issuer, none is concluded, and nothing is written
        - a party a caller names itself is not the one written
    - a module that writes contracts does not start without an issuer
        - the contract module, which starts once the file names one
        - the checkout offer module, where it concludes offers
        - the platform, whose tenant billing freezes contracts
        - while a module that only keeps the subscribers starts without one
- `packages/nest/tests/a-successor-replaces-the-contract-in-force.test.js`
    - writing a successor
        - a successor of a contract the migration copied copies both parties afresh
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - an invoice that cannot be issued yet
        - waits under a contract ${what}
- `packages/nest/tests/an-operator-carries-a-vocabulary-into-running-contracts.test.js`
    - carrying the features over
        - the parties are the ones agreed, not a correction made since — and a migrated copy stays
          marked
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - every contract names the subscriber it is concluded with
        - each contract names its tenant's subscriber, with a copy that says the migration made it

<!-- END proof -->

### SC-AUD-013 — Every invoice line can be traced to the charge and the contract line it came from

🟢 💰 The charge already names its agreement line (`SC-AUD-010`);
the invoice line adds the step from the document to the charge.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/an-invoice-is-drawn-up-from-its-charges.test.js`
    - the lines of an invoice
        - follow the contract’s lines, each naming its charge and its contract line, titled as the
          contract titles it
        - of the same contract line come in the order of their periods
        - refuse a charge whose contract line the contract does not have
        - refuse charges in two currencies, which no invoice states
- `packages/core/tests/an-invoice-row-becomes-a-record.test.js`
    - a line names the line of its invoice it corrects exactly where it is a correction’s
        - written and read, a correction’s line keeps the position it corrects
        - ${what} is not written
        - ${what} stops the read, naming the row
- `packages/nest/tests/an-invoice-is-issued.test.js`
    - an invoice is issued for the charges booked together
        - the opening of a period is one invoice, its lines in the contract’s order
        - a charge that arises later in the period is an invoice of its own, numbered after
        - groups waiting from earlier are issued oldest first, so their numbers follow the charges
        - a second run issues nothing the first one issued
        - a charge another instance invoiced first is passed over, neither issued nor failed
        - a failure of one invoice holds up none of the others, and the next run issues it

<!-- END proof -->

### SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering

🟢 💰 The rendered document is archived when the invoice is
issued, and every later download, by the tenant or by the operator, returns that archived file;
an invoice whose document is not yet archived is not offered at all (`SC-PRIC-033`). Rendering
it again from today's data would hand out a document the subscriber never received.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/persistence-contract.integration.test.js`
    - the database archive says whether it keeps what it holds
        - built from the reference schema alone, it names the triggers it lacks
        - with the migration applied, it keeps what it holds
        - with one of its triggers disabled, it names that one
- `packages/adapter-prisma/tests/integration/persistence-contract.integration.test.js`
    - the database archive says whether it keeps what it holds
        - built from the reference schema alone, it names the triggers it lacks
        - with the migration applied, it keeps what it holds
        - with one of its triggers disabled, it names that one
- `packages/core/tests/an-invoice-document-row-becomes-a-record.test.js`
    - the database archive
        - with both of its triggers enabled keeps what it holds
        - ${what} names what it lacks, and the file that adds it
- `packages/nest/tests/a-tenant-reads-its-invoices.test.js`
    - an invoice's document
        - of the subscriber’s own invoice is the archived file
        - of an earlier tenant joined into the subscriber is the archived file too
        - ${why} is not found, and nothing is read from the archive
- `packages/nest/tests/an-invoice-document-is-archived-and-mailed.test.js`
    - an invoice’s document downloaded later
        - is the archived file, not a new rendering
        - of an invoice that does not exist is answered as not found
        - of an invoice still waiting for its document is not offered
        - ${what} is not handed out, and shown to the operator
    - the operator’s download
        - is served where invoices are, answers the archived file, and the manifest announces it
        - offers a file name that cannot end the header it stands in
        - of a file with no name it could keep offers one
        - without ${without}, neither the route nor the capability exists
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - invoices start
        - not beside an archive that would let a document it keeps be changed, naming why
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - an archived invoice document is kept as it was issued
        - refuses ${what}, and the file stays
        - still refuses after the migration ran a second time
        - takes a file for another invoice, and none for the same one again

<!-- END proof -->

### SC-AUD-015 — An archived invoice is checked against the checksum recorded when it was rendered

🔵 _(Superseded on 2026-10-11 by `SC-AUD-019`.)_
💰 The document is rendered from what the invoice records and
nothing else, never the current time or today's settings, and its checksum is recorded with the
invoice before it is archived. An archiving attempt repeated after an interruption (`SC-PRIC-033`)
stores a file with that checksum, every download is checked against it, and a file that does not
match is not handed out but shown to the operator. The register's export (`SC-ADM-022`) carries each
checksum.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-AUD-019 — An archived invoice is checked against the checksum of the file it was issued as

🟢 💰 The document is rendered from what the invoice records and
nothing else, never the current time or today's settings, and its checksum is recorded with the
invoice before it is archived. Once the archive holds a file for the invoice, that file is the one
the invoice was issued as, and the record follows it. Until then nothing has been handed out, so an
attempt repeated after an interruption (`SC-PRIC-033`) that renders other bytes — a renderer updated
in between — records the new checksum in place of the old one and writes both to the audit log,
rather than holding a numbered invoice that can never be sent. Every download is checked against the
recorded checksum, and a file that does not match is not handed out but shown to the operator. The
register's export (`SC-ADM-043`) carries each checksum.

_Source:_ #424 · #332 · #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-invoice-document-is-archived-and-mailed.test.js`
    - an issued invoice’s document
        - is rendered from the invoice as issued, checked, its checksum recorded, and archived
        - is archived once: the next run renders nothing again
        - that the adapter refuses waits under its number, recorded nowhere, until the defect is
          fixed
        - whose hold could not be written to the audit log is written there by the next run
        - rendered in another shape before anything was archived takes the place of the recorded
          one, both named in the audit log
        - rendered again is not put in place of the recorded one where the audit log cannot say so
        - the archive already keeps is the one it was issued as: the record follows it, and nothing
          is rendered
        - the archive keeps in another shape than the one recorded is the one the record follows,
          both named in the audit log
        - the archive keeps and the adapter refuses is held, and the archived one stays
        - the archive keeps that no longer matches its own checksum is held for the operator
    - an invoice’s document downloaded later
        - is the archived file, not a new rendering
        - of an invoice that does not exist is answered as not found
        - of an invoice still waiting for its document is not offered
        - ${what} is not handed out, and shown to the operator

<!-- END proof -->

### SC-AUD-016 — Concluding or changing a contract gives the subscriber a confirmation to keep

🟢 💰 It names the plan and the bundles, their prices with the tax
treatment (`SC-PRIC-038`), the term, the notice period and the version of the operator's terms that
applied. That version is the one `config/saas.yaml` named when the contract was concluded or changed,
which the contract records; the confirmation takes it from the contract, so one rendered again after
new terms are published still names the terms the subscriber agreed to (`SC-AUD-019`). It is
rendered and archived like an invoice (`SC-AUD-019`),
sent to the subscriber's invoice email and offered for download beside the invoices (`SC-UI-023`).
German law asks for the terms of a contract concluded online, general terms included, to be
retrievable and storable when it is concluded.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/persistence-contract.integration.test.js`
    - the confirmation archive says whether it keeps the confirmations it holds
        - without the migration, the triggers it lacks
        - once the migration ran, none
        - with the one against an update or a delete disabled, that one
- `packages/adapter-prisma/tests/integration/persistence-contract.integration.test.js`
    - the confirmation archive says whether it keeps the confirmations it holds
        - built from the reference schema alone, it names both triggers
        - with the migration applied, nothing
        - with the one against a truncate disabled, that one
- `packages/core/tests/a-confirmation-state-is-read-off-its-record.test.js`
    - the state of a contract’s confirmation
        - ${what} is ${state}
- `packages/invoice-zugferd/tests/renders-a-contract-confirmation.test.js`
    - a contract’s confirmation
        - names the parties, the contract’s facts, its lines and what it costs, in German and
          English
        - states the notice period and the terms it was concluded under, attached
        - of a contract concluded under no terms says so, rather than naming a version
        - carries the treatment’s note where the contract’s treatment has one
        - renders into the same bytes every time, and dated when the contract was written
        - runs on over as many pages as its lines need, each numbered
        - is refused for a contract that names no issuer
- `packages/nest/tests/a-contract-is-confirmed.test.js`
    - a contract written is confirmed
        - rendered from the contract with the footer the file names and the zone it is told in,
          archived, and mailed with the terms
        - a second run renders and mails nothing again
        - a contract that records no terms is mailed with its confirmation alone
        - a contract that names another entity than the file is confirmed without the file’s footer
        - a contract written before confirmations is due none
    - a confirmation that cannot be made yet is held, and said once
        - for a contract whose parties a migration copied, or that names no issuer
        - for a contract whose terms the archive does not hold, until it does
        - for a subscriber without an invoice email, until one is entered
        - for a mail that fails, which the next run sends
    - the confirmation handed out again
        - is the archived file, and refused for no contract, one with none archived, and a file that
          does not match
    - a subscriber’s contracts, as the operator reads them
        - are every contract, the newest first, each with where its confirmation stands
        - of a subscriber without contracts are none, and of one there is not are refused
    - a contract’s dossier
        - is the contract as it was frozen, each line with where it came from, and the invoices
          issued under it
        - says when its archived confirmation no longer matches, and writes that to the audit log
          once
        - is waiting while its confirmation is due and not archived, and not due for one written
          before
        - without a catalogue to ask, no line says where it came from
        - of another subscriber’s contract is refused as one that does not exist, as are an unknown
          one and an unknown subscriber
    - the confirmations start
        - not beside an archive that would let a confirmation it keeps be changed, naming why
    - the quarter-hourly run
        - confirms a contract written since the last one
    - the operator’s download of a confirmation
        - is served beside the invoices’ documents, and answers the archived file under its name
        - serves the subscriber’s contracts in its record, read outside any row policy, and the
          manifest announces both
        - serves a contract’s dossier in its record, read outside any row policy, each line with
          where the platform’s catalogue has it
        - starts where the catalogue’s repositories need what only the catalogue is given, and asks
          them there
        - is not served where the administration is not
- `packages/nest/tests/invoices-start-only-as-configured.test.js`
    - the confirmations every contract is due, beside the invoices
        - start from the renderer alone, keeping their record and their files in the bundle
        - are required: invoices do not start without their renderer, which the refusal names
        - do not start without their ${port}, where the bundle keeps none either
        - do not start beside an archive that would let a confirmation it keeps be changed
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a contract written before confirmations is due none, and an archived one is kept
        - a contract no repository wrote is due none, as db push leaves those already there
        - a database from before gains the tables of the confirmations as the fragments declare them
        - an archived confirmation refuses ${what}, and stays
        - an archived confirmation still refuses a delete after the migration ran a second time
- `packages/ui-vue/tests/an-archived-file-is-downloaded.test.js`
    - a file through ${name}
        - arrives as the bytes the server sent, under the name it offers
        - without a name offered is saved under the one the download falls back to
        - refused reads as the platform’s code, and a JSON read beside it is untouched
    - a file through a client of the application’s own
        - asks for any type rather than JSON where createFetchHttpClient sends it
        - whose responses have no bytes() is said, rather than read as text
    - a downloaded file saved
        - is handed over with exactly its bytes and name, and its address let go
    - the browser's save
        - keeps the object URL for its lifetime, and lets it go then
    - a download from a row
        - saves the file, says which row is on its way, and takes one at a time
        - that fails tells the operator why, and leaves the row free for another try
    - the downloads and the contracts in a subscriber’s record
        - are offered each where the manifest announces its route
        - are read where the manifest announces them, and not otherwise
- `packages/ui-vue/tests/component/subscriber-record-shows-the-contracts.test.ts`
    - the subscriber's record shows its contracts
        - one timeline per tenant, the latest start first, each naming what it changed and where its
          confirmation stands
        - marks the contracts in force on a day picked, and says so when none was
        - a contract superseded before it began says it was never in force, and is marked on no day
        - opens the contract its address names, and brings it into view
        - brings the contract its address names into view when the record answers after the
          contracts
        - brings the contract its address names into view once, however often the record and its
          contracts are read again
        - brings the contract into view where it shows only on a later read
        - says when a contract was concluded and until when its minimum term runs as the
          installation’s days
        - opens a contract into what it froze: its lines with where each came from, its invoices and
          its ids
        - leads to the catalogue, and back to the list, where the shell put those pages
        - leads to no catalogue page the platform does not serve
        - shows each line’s features and quotas, and filters the lines by them
        - copies an id, and says whether the browser let it
        - a confirmation that no longer matches its checksum is said at the contract, and not
          offered
        - a confirmation not archived yet, or not due, is said and not offered
        - downloads an intact confirmation under the name it was archived with
        - a confirmation and an invoice made in a test operation are named a test, and live ones as
          before
        - a download that fails says so, and saves nothing
        - a contract that fails to load says so
        - opening another contract closes the first, and reads the one opened
        - nothing of them where the platform does not serve them
    - the subscriber's record downloads an invoice's document
        - only where the platform serves it, the cancellation beside it or not
        - only for an invoice whose document is archived
        - beside the invoice, under the name it was issued with

<!-- END proof -->

### SC-AUD-018 — An operator finds what one person did by their e-mail, whatever they acted through

🟢 `<app> audit tail --actor <email>` lists the entries of that person from the web and the command
line alike, and so does a pattern with a star at its start, its end or both, matched without regard
to case, through every shipped adapter the same way. A value with a colon or a star is taken as the
tag or pattern it already is.

_Source:_ #371

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/audit-tail-flow.test.js`
    - AuditTailFlow.run — filter mapping
        - an e-mail is looked for between the source and the context

<!-- END proof -->

### SC-AUD-022 — One request names one user, on every route that records or checks who acted

🟢 🔒 The second factor, the audit log, the publisher of a version, a promotional code's author, the
promotion preview's rate limit and a tenant's own writes read the user behind a request from one
place: the application's `userIdResolver` at the root of the platform's options, or without one
`sub`, then `id`. The user's e-mail and the session the request came from are read the same way for
every record. Where a request names nobody — an empty value included — a route that checks who
acted refuses it, and a record that only notes who acted says `unknown` rather than inventing an
address.

_Source:_ #338

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/one-request-names-one-user.test.js`
    - without a resolver, every way reads `sub`, then `id`
        - `sub` names the user
        - `id` names the user
        - `sub` wins over a different `id`
        - an empty `sub` names nobody, so the `id` beside it does
        - `userId` alone names nobody
        - an integer `id` names the user as its decimal text
        - an `id` that is not a finite number or a string names nobody
        - an empty `id` names nobody
        - a user with none of the fields names nobody
    - with a resolver at the module's root, every way reads it
        - a `userId` the resolver reads names the user
        - a `sub` the resolver does not read names nobody
        - an empty value the resolver returns names nobody
    - the rate limit keys its window by the same rule
        - a request naming the same user by another shape shares the window
    - the actor beside the user
        - an operator record and a tenant record take the e-mail and the session from the same place
        - without an e-mail the record says it does not know one, rather than inventing an address
        - without a session, an operator record says it came from the administration
    - the resolvers live at the root, and nowhere else
        - `tenantBilling.userIdResolver` refuses the start and names the root
        - `tenantBilling.userEmailResolver` refuses the start and names the root
        - `tenantBilling.auditContextResolver` refuses the start and names the root
        - a key under `tenantBilling` whose value is `undefined` binds nothing, and starts
- `tests/the-user-behind-a-request-is-read-in-one-place.test.js`
    - the user behind a request is read in one place
        - the scan sees each shape a read takes
        - and leaves alone what is not one
        - only core/request-user.ts reads it

<!-- END proof -->

### SC-AUD-023 — An installation's operation is fixed with its first document

🟢 💰 Once an invoice has been issued or a contract confirmation rendered, the installation's mark
says the operation those documents recorded and no other: `installation mark` refuses to mark it
as the other operation, with `--replace` too, and refuses to change the operation at all where the
documents cannot be read, since then nothing shows that none exists. A start that issues invoices
refuses where the documents recorded another operation than the mark says, or both, naming them.
So an installation that issued live documents never turns into a test operation, and a test
operation never turns live; leaving one is a new installation. The command reads the documents
before it writes the mark: a first document issued between the two is not seen by it, and the next
start refuses.

_Source:_ #523

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/installation-cli-flow.test.js`
    - installation mark --operation
        - refuses another operation once a document exists, as a conflict, and writes nothing
- `packages/nest/tests/an-installations-operation-is-fixed-with-its-first-document.test.js`
    - installation mark, once the installation has issued a document
        - changes the operation while no document exists
        - refuses another operation once an invoice exists, naming both, and writes nothing
        - refuses it where only a confirmation was rendered
        - marks with the operation the documents recorded, and with it alone
        - --replace with the operation that stands goes ahead, with another it is refused
        - moves a mark that says another operation to the one its documents recorded
        - refuses either operation where the documents recorded both
        - refuses any change where a store of the documents cannot be read, and marks as it stands
        - reads every tenant's documents, inside the bypass frame
    - where the command reads the documents from
        - an installation without invoices reads them from the persistence bundle's stores
        - tenant billing wired by hand reads the stores its deletion names, and refuses without them
    - a start that issues invoices
        - goes on where the documents recorded the operation the mark says
        - goes on while no document exists, whatever the mark says
        - is refused where the invoices recorded another operation than the mark, naming both
        - is refused where only the confirmations recorded another
        - is refused where the documents recorded both, naming both

<!-- END proof -->

### SC-AUD-025 — An operator's command line starts where the application refuses on its documents

🟢 💰 Where the documents an installation issued recorded another operation than its mark says, or
both, the application refuses to start (`SC-AUD-023`), and an operator's command line starts all
the same: `installation status` and the doctor name the disagreement, the doctor as an error, and
`installation mark` with the operation the documents recorded repairs it, after which the
application starts. In place of its start, the command line refuses each invoice it would issue
in the mark's operation and each confirmation it would first render while the two disagree; a
cancellation and its replacement, which take the cancelled invoice's operation, remain possible.
A process is a command line by declaration, which `CliContextModule` makes; nothing infers it from
the shape of the process, since a worker without an HTTP server issues invoices as the application
does. Where the documents recorded both operations, no command repairs the installation, and it
issues no further document in the mark's operation.

_Source:_ #523

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/default-doctor-checks.test.js`
    - InstallationMarkDoctorCheck on how the installation operates
        - is an error where the documents recorded another operation, naming the mark that repairs
          it
        - is an error where the documents recorded both, which no mark repairs
- `packages/cli/tests/installation-cli-flow.test.js`
    - installation mark --operation
        - the status names documents that recorded another operation, and the mark that repairs it
- `packages/nest/tests/a-confirmation-records-the-operation-it-was-made-in.test.js`
    - a confirmation first rendered in an operator command line
        - is not made while the documents recorded another operation than the mark
        - is made where they recorded the operation the mark says
- `packages/nest/tests/an-installations-operation-is-fixed-with-its-first-document.test.js`
    - an operator command line, where the application refuses to start
        - starts where the documents recorded another operation than the mark, or both
        - says what the documents recorded, and marking it as they say lets the application start
        - refuses to issue an invoice while the mark and the documents disagree
- `examples/notesapp/tests/the-notes-app-cli-marks-its-installation.test.mjs`
    - the notes app's command line
        - says it is an operator command line, which the application does not

<!-- END proof -->

### SC-AUD-024 — Every document issued in a test operation says it is one

🟢 💰 An invoice, a cancellation invoice, a replacement and a contract confirmation issued in a test
operation, as each records it, say so on every page, so that neither their recipient nor a tax
auditor takes one for a real document: the title calls it a test document, on the first page and
at the head of every page after it, and so does the title in its metadata; a notice that it is not
an invoice for VAT purposes, on a confirmation that it confirms no contract, stands under the title
and at the foot of every page; an invoice's XML states that notice as its first note. A document
issued live says none of it. Its amounts, tax and due date are those of any document, so a test
invoice falls due and is collected as a live one. The renderers SaaSiCat ships write all of it,
and the German tax adapter holds every invoice file to it, whichever renderer wrote it: a test
invoice whose XML does not state the notice first, or a live one whose XML states it, waits under
its number (`SC-PRIC-042`). Where it stops: the adapter reads the XML and not the page, so the page
of an application's own invoice renderer is not checked; and an application's own confirmation
renderer is handed the operation and the wording, but nothing checks what it prints, since a
confirmation is a plain PDF with no XML, which the format's validators do not read either.

_Source:_ #523

<!-- BEGIN proof -->

_Tested by:_

- `packages/invoice-zugferd/tests/a-document-issued-in-a-test-operation-says-so-on-every-page.test.js`
    - every renderer the package exports is held to what a test operation marks
    - ${renderer}, for a document issued in a test operation
        - (${name}) says so in its title and in the notice under it, at the foot of every page, in
          its metadata${carriesXml ? ' and first in its XML' : ''}
        - (${name}) renders into the same bytes every time
        - is rendered over more than one page at least once, so that every page is read
    - ${renderer}, for a document issued live
        - (${name}) says none of it, on any page, in its metadata${carriesXml ? ' or in its XML' :
          ''}
- `packages/invoice-zugferd/tests/renders-an-invoice-the-german-adapter-accepts.test.js`
    - an issued invoice and its twin issued in a test operation
        - (${name}) are each refused by the German adapter as the file of the other
- `packages/nest/tests/an-invoice-records-whether-it-was-issued-in-a-test-operation.test.js`
    - the file of an invoice, checked by the tax adapter
        - of one issued in a test operation reaches the check as one, and is held where the adapter
          refuses it
        - of one issued live reaches the check as live, and is archived
- `packages/tax-de/tests/an-invoice-file-says-whether-it-was-issued-in-a-test-operation.test.js`
    - the file of an invoice issued in a test operation
        - stating the notice as its first note passes
        - ${what} is refused
    - the file of an invoice issued live
        - stating no note, or another one, passes
        - ${what} is refused

<!-- END proof -->

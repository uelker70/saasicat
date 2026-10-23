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
holds says who its parties were that day, so its charges stay held (`SC-PRIC-096`). Every
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

🟡 _(Decided, not yet delivered.)_ 💰 The rendered document is archived when the invoice is
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

🟡 _(Decided, not yet delivered.)_ 💰 The document is rendered from what the invoice records and
nothing else, never the current time or today's settings, and its checksum is recorded with the
invoice before it is archived. Once the archive holds a file for the invoice, that file is the one
the invoice was issued as, and the record follows it. Until then nothing has been handed out, so an
attempt repeated after an interruption (`SC-PRIC-033`) that renders other bytes — a renderer updated
in between — records the new checksum in place of the old one and writes both to the audit log,
rather than holding a numbered invoice that can never be sent. Every download is checked against the
recorded checksum, and a file that does not match is not handed out but shown to the operator. The
register's export (`SC-ADM-022`) carries each checksum.

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

🟡 _(Decided, not yet delivered.)_ 💰 It names the plan and the bundles, their prices with the tax
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
    - a tenant’s contracts, as the operator reads them
        - are every contract, the newest first, each with where its confirmation stands
        - of a tenant without contracts are none
    - the confirmations start
        - not beside an archive that would let a confirmation it keeps be changed, naming why
    - the quarter-hourly run
        - confirms a contract written since the last one
    - the operator’s download of a confirmation
        - is served beside the invoices’ documents, and answers the archived file under its name
        - serves the tenant’s contracts beside it, found by its slug outside any row policy, and the
          manifest announces both
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
    - a download from a row
        - saves the file, says which row is on its way, and takes one at a time
        - that fails tells the operator why, and leaves the row free for another try
    - the downloads and the contracts beside a tenant
        - are offered each where the manifest announces its route
        - are read where the manifest announces them, and not otherwise
- `packages/ui-vue/tests/component/tenant-detail-shows-the-contracts.test.ts`
    - the tenant detail shows the tenant's contracts
        - every one, the newest first, with what it records and where its confirmation stands
        - downloads an archived confirmation under the name it was archived with
        - a download that fails says so, and saves nothing
        - nothing of them where the platform does not serve them
    - the tenant detail downloads an invoice's document
        - only where the platform serves it, the cancellation beside it or not
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

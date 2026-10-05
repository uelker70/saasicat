---
title: Repeating an operation safely
---

Deployments fail and get retried; containers restart; a pipeline step is run again. This chapter
is written from the operator's side and says what they can repeat without holding their breath.
The requirement behind all of it: SaaSiCat keeps no ledger of which migrations have run, so every
one of them has to be safe to run twice.

Some migrations must not run beside the application at all: one that moves rows, or removes what the
version still running reads. For those the operator takes the application out of service for the
length of the deploy, and tells the tenants first. The lock that does it has to outlast the restart
it protects, and it ends when the operator says so.

### SC-OPS-001 — An operator can retry a failed deployment

🟢 Every shipped migration applied a second time either does nothing, or refuses with a sentence
saying why. Never an unexplained database error, and never a second application of the same
effect. This exists because it happened: a migration dropped a column, the next container start
asked that column for its values, and the message named the column rather than the retry.

_Source:_ `CONTRIBUTING.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/a-booking-outlives-the-request.integration.test.js`
    - what a booking carries
        - a booking with a window keeps every part of it
        - a booking from before those columns keeps null, not an invented window
        - an id nobody booked answers null rather than throwing
        - the list is the subscription’s own, not the neighbour’s
        - a subscription with no bookings lists nothing, rather than everything
    - what counts as active
        - a booking nobody cancelled is active
        - a cancellation still ahead leaves it active
        - a cancellation that has landed ends it
        - the effective date itself is the first moment it is over
        - asking without a moment asks about now
    - undoing a cancellation
        - reactivating clears both dates and the booking is active again
        - cancelling something that is not there says so, rather than doing nothing quietly
        - reactivating something that is not there says so too
    - counting what a catalogue version still owes
        - active bookings of that version are counted, across subscriptions
        - a different version is not counted
        - a booking whose cancellation has landed is not counted
        - a version nobody booked counts zero
- `packages/nest/tests/registration-service.test.js`
    - runCleanup() without expired → deleted=0, idempotent

<!-- END proof -->

### SC-OPS-002 — A migration is safe on a partially adopted schema

🟢 An installation that never took a particular table migrates the ones it does have, instead of
rolling the whole thing back.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/migration-constraints.test.js`
    - which migration the constraints belong to
        - the one that appeared between the two listings
        - nothing new means nothing to append to, even with migrations present
        - directories that are not migrations are not candidates
        - the newest of several, when a run somehow produced two
        - no migrations at all is not an error, it is nothing to do
    - appending them
        - the statements land after the tables
        - it says where the copy came from
        - running it twice appends once
        - a migration that already has them is recognised
        - a migration without a trailing newline still gets a separating one
    - only the constraints this schema has tables for
        - reads the table off each statement
        - keeps the ones whose table is present
        - keeps everything when every table is present
        - a statement it cannot read is kept, not dropped
        - nothing applicable appends nothing at all
    - what step 3 did, and whether step 4 may follow
        - only a failure stops the command
        - "before applying" is said exactly when the command will not apply
        - a failure says where the SQL is, because the operator now needs it
        - nothing to append is not a failure
        - every outcome carries a message and a decision
- `packages/cli/tests/schema-apply-dry-run.test.js`
    - the dry run previews what the real run writes
        - it names the lines, and leaves the file untouched
        - and the real run writes exactly those lines
        - past tense belongs to the run that did it
- `packages/cli/tests/schema-apply.test.js`
    - extractModelNames
        - finds top-level models
    - ignores commented-out models
    - does not find enum blocks
    - a fragment yields its enums and its models
    - apply appends the enum above the model, once
    - an enum the consumer already declares is left alone
    - a bare model map still works, with no enums
    - extractModelBlocks
        - block stays complete with all lines
    - applyFragmentBlocks
        - adds all models when schema is empty of platform models
        - idempotent: existing models remain untouched
        - returns identical schema when all models already present
        - label appears in the header comment
- `packages/cli/tests/schema-check.test.js`
    - parseFields
        - reads name, type and modifiers, skips attributes and comments
    - reads single-line model blocks
    - identical attributes produce no finding
    - a missing index is reported but does not fail the check
    - a missing unique constraint fails the check
    - a diverging @@map fails the check and names both sides
    - whitespace and attribute options do not create false findings
    - extra consumer indexes are not reported
    - a cascade from the tenant onto the contract fails the check, naming the relation
    - a restriction, no relation, or a commented one passes
    - while a model the fragments point at the tenant keeps its cascade
    - the shipped fragments keep the contract past its tenant
    - its relation field is not reported as missing, in either direction
    - and the field is required again as soon as the model is adopted
    - and the shipped fragments really carry such a relation
    - and a narrowed run behaves like a full one, given the shipped models
    - a type neither schema declares is still drift
    - a model left out of a fragment whose other model is adopted fails, naming both
    - an optional model may be left out of an adopted fragment
    - a fragment left out whole is a decision, not drift
    - a model adopted alone counts for its fragment, whichever it is
    - without the fragments named, no fragment is held to being whole
    - parseEnumValues
        - reads members and ignores attributes
        - reads members sharing one line
    - parseSchema
        - separates models from enums
        - commented-out relations are not fields
    - checkSchema
        - identical schema has no drift
        - consumer extensions are not drift
        - missing field in an adopted model fails
        - absent model is informational, not a failure
        - missing enum value in an adopted enum fails
        - absent enum is informational, not a failure
        - type change is a mismatch
        - String replaced by a locally declared enum is allowed
        - String[] replaced by a local enum list is allowed
        - a non-String spec type is not substitutable by an enum
        - a consumer widening a required field to nullable is a mismatch
        - a consumer tightening a nullable field to required is allowed
        - list change is a mismatch
    - parser hardening (review findings)
        - a commented-out @@unique or @@map counts as absent, not present
        - a brace inside a string default does not close the model early
        - a // inside a string literal is not treated as a comment
        - indexed field arguments are parsed past their parentheses
        - @@map survives the comment strip
    - blankStringLiterals
        - blanks contents, keeps quotes and length
        - handles escaped quotes without leaving the string early
        - leaves a line without strings untouched
        - is linear on pathological input
    - the shipped fragments
        - the subscriber fragment is one unit: the shipped repository writes all of it
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a shipped migration survives a second run
        - there are migrations to check
        - ${name} runs twice, and the second time changes nothing
    - a shipped migration leaves an installation without its tables alone
        - ${name} runs on a database with none of the platform tables, twice
    - a table a migration creates has the shape the fragments declare
        - every table the migrations create on an empty database, in the order a consumer applies
          them
    - a migration that would merge rows stops instead
        - two project keys stop it, and the message names them
        - and the installation is exactly as it was afterwards
        - one project key goes through
    - the applied settings hold one row, and the database is what holds them to it
        - a second id is refused by the constraint, on the reference schema
        - and on a database that gained the tables from the migration alone
    - a settings change carries the order it was recorded in
        - rows recorded before the column keep the order they were listed in, and the numbering
          continues
        - a second run leaves every number where the first one put it
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to
        - and the columns come out of it required, so nothing can be written without them
        - a second run leaves the values the first one wrote
        - a contract with ${what} stops the migration and is named
        - and the table is exactly as it was afterwards
        - a rate ${what} stops the migration and is named
        - a percentage ${what} is recorded as it stands
        - a line that already carries a fraction as its own rate stops the migration too
        - a value already in a column is kept, and a row missing only one is still found
        - an installation that never took the fragment is left alone
        - a line whose contract is gone is named as itself, not as an empty space
        - the query the guide ships finds exactly what the migration refuses
        - a contract that records both goes through
    - every contract names the subscriber it is concluded with
        - every tenant with a subscription or a contract gets one subscriber, named from its own
          table, in the order it came
        - each contract names its tenant's subscriber, with a copy that says the migration made it
        - a prefix set for the session numbers the migrated subscribers the way new ones are
          numbered
        - a prefix the configuration would refuse creates no subscriber
        - a second run leaves everything as the first one left it, a tenant added in between
          included
        - without a foreign key naming the tenant table it stops, names the tenants, and leaves the
          tables in place
        - a tenant table without a name column stops it, naming the table
        - a tenant with no row or an empty name stops it, and both are named
        - a role row-level security hides contracts from stops it, naming the table and the role
        - and so does row-level security on the tenant table the legal names come from
        - once it has run through, a run as a role under row-level security does nothing
        - the statement the guide shows creates the subscribers it could not, and it then goes
          through
    - a payment method is the gateway reference, kept for the subscriber
        - a database from before ends up with the schema the fragments declare
        - an event recorded before carries its provider as its account, and stays unique
        - a second run leaves the accounts the first one gave, an event recorded in between included
        - two confirmations of one session are refused by name rather than by a unique violation
        - an installation without self-registration gets the payment methods and nothing else
        - an installation without subscribers is left without the payment methods, and runs through
        - the old masked payment methods an application wrote are left where they are
    - customer numbers count from 10001
        - on the reference schema, and again after the identity is restarted
        - and the constraints applied again move a sequence that has handed numbers out nowhere
    - a scheduled change learns the version it was quoted at
        - a change to another plan is given the version live now; the rest are left empty
        - a plan stored by its row id is found through its key, as the Prisma adapter's
          normalized-plan-id binding stores it
        - a schema with no plans table is matched by key alone
        - a second run pins nothing published since the first
    - the pending version is dropped
        - the seven columns go, and their index and foreign key with them
        - a second run finds nothing to drop and changes nothing
    - a subscriber has a tax origin, and a contract its treatment
        - a database from before ends up with the schema the fragments declare
        - a subscriber and a contract from before keep their rows, with nothing stated and nothing
          decided
        - an installation without subscribers gets the treatment column and nothing else
    - a correction carries the order it was recorded in
        - rows recorded before the column keep the order they were listed in, and the numbering
          continues
        - a second run leaves every number where the first one put it
    - a booking's scheduled switch holds its version and its moment together
        - one without the other is refused by the constraint, both or neither are not, on the
          reference schema
        - and on a database that gained the columns from the migration, with the constraints after
          it

<!-- END proof -->

### SC-OPS-003 — An operator can list what a migration will touch before running it

🟢 Every migration that changes rows ships with the query that shows which ones.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/schema-apply.test.js`
    - extractModelNames
        - finds top-level models
    - ignores commented-out models
    - does not find enum blocks
    - a fragment yields its enums and its models
    - apply appends the enum above the model, once
    - an enum the consumer already declares is left alone
    - a bare model map still works, with no enums
    - extractModelBlocks
        - block stays complete with all lines
    - applyFragmentBlocks
        - adds all models when schema is empty of platform models
        - idempotent: existing models remain untouched
        - returns identical schema when all models already present
        - label appears in the header comment
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a shipped migration survives a second run
        - there are migrations to check
        - ${name} runs twice, and the second time changes nothing
    - a shipped migration leaves an installation without its tables alone
        - ${name} runs on a database with none of the platform tables, twice
    - a table a migration creates has the shape the fragments declare
        - every table the migrations create on an empty database, in the order a consumer applies
          them
    - a migration that would merge rows stops instead
        - two project keys stop it, and the message names them
        - and the installation is exactly as it was afterwards
        - one project key goes through
    - the applied settings hold one row, and the database is what holds them to it
        - a second id is refused by the constraint, on the reference schema
        - and on a database that gained the tables from the migration alone
    - a settings change carries the order it was recorded in
        - rows recorded before the column keep the order they were listed in, and the numbering
          continues
        - a second run leaves every number where the first one put it
    - a line item learns the money it was booked with
        - the values come from the contract the line belongs to
        - and the columns come out of it required, so nothing can be written without them
        - a second run leaves the values the first one wrote
        - a contract with ${what} stops the migration and is named
        - and the table is exactly as it was afterwards
        - a rate ${what} stops the migration and is named
        - a percentage ${what} is recorded as it stands
        - a line that already carries a fraction as its own rate stops the migration too
        - a value already in a column is kept, and a row missing only one is still found
        - an installation that never took the fragment is left alone
        - a line whose contract is gone is named as itself, not as an empty space
        - the query the guide ships finds exactly what the migration refuses
        - a contract that records both goes through
    - every contract names the subscriber it is concluded with
        - every tenant with a subscription or a contract gets one subscriber, named from its own
          table, in the order it came
        - each contract names its tenant's subscriber, with a copy that says the migration made it
        - a prefix set for the session numbers the migrated subscribers the way new ones are
          numbered
        - a prefix the configuration would refuse creates no subscriber
        - a second run leaves everything as the first one left it, a tenant added in between
          included
        - without a foreign key naming the tenant table it stops, names the tenants, and leaves the
          tables in place
        - a tenant table without a name column stops it, naming the table
        - a tenant with no row or an empty name stops it, and both are named
        - a role row-level security hides contracts from stops it, naming the table and the role
        - and so does row-level security on the tenant table the legal names come from
        - once it has run through, a run as a role under row-level security does nothing
        - the statement the guide shows creates the subscribers it could not, and it then goes
          through
    - a payment method is the gateway reference, kept for the subscriber
        - a database from before ends up with the schema the fragments declare
        - an event recorded before carries its provider as its account, and stays unique
        - a second run leaves the accounts the first one gave, an event recorded in between included
        - two confirmations of one session are refused by name rather than by a unique violation
        - an installation without self-registration gets the payment methods and nothing else
        - an installation without subscribers is left without the payment methods, and runs through
        - the old masked payment methods an application wrote are left where they are
    - customer numbers count from 10001
        - on the reference schema, and again after the identity is restarted
        - and the constraints applied again move a sequence that has handed numbers out nowhere
    - a scheduled change learns the version it was quoted at
        - a change to another plan is given the version live now; the rest are left empty
        - a plan stored by its row id is found through its key, as the Prisma adapter's
          normalized-plan-id binding stores it
        - a schema with no plans table is matched by key alone
        - a second run pins nothing published since the first
    - the pending version is dropped
        - the seven columns go, and their index and foreign key with them
        - a second run finds nothing to drop and changes nothing
    - a subscriber has a tax origin, and a contract its treatment
        - a database from before ends up with the schema the fragments declare
        - a subscriber and a contract from before keep their rows, with nothing stated and nothing
          decided
        - an installation without subscribers gets the treatment column and nothing else
    - a correction carries the order it was recorded in
        - rows recorded before the column keep the order they were listed in, and the numbering
          continues
        - a second run leaves every number where the first one put it
    - a booking's scheduled switch holds its version and its moment together
        - one without the other is refused by the constraint, both or neither are not, on the
          reference schema
        - and on a database that gained the columns from the migration, with the constraints after
          it
- `tests/build-stamp.test.js`
    - the build stamp
        - is stable across runs and changes with a source edit
        - sees a deleted file and a build config, not a test
        - a dependency edit makes the dependent stale
        - no stamp means not current
    - which builds are judged at all
        - only a build through build-and-prune writes a stamp
    - a build that does not finish leaves no stamp
        - the previous stamp is gone before the build starts
        - the lockfile is an input

<!-- END proof -->

### SC-OPS-004 — A destructive step is preceded by a check, not by turning the safety off

🟢 Adding a flag that lets a tool discard data would arm every future change to do the same without
being asked.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-005 — A tool that cannot finish stops before it changes anything

🟢 Where the advice it prints is only followable while the change is unapplied, it does not apply
half of it first.

_Source:_ release 0.27.0

### SC-OPS-006 — Applying the same external event twice changes nothing

🟢 Payment providers retry, and a retry must not produce a second account or a second charge.

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-sign-up-activates-on-a-confirmed-payment-method.test.js`
    - the confirmation of the payment method activates the sign-up
        - the same confirmation delivered twice activates once

<!-- END proof -->

### SC-OPS-007 — Repeating an action a person took changes nothing either

🟢 Cancelling twice, ending an already-ended contract — each reports the state that already holds
instead of creating a second effect.

_Source:_ release 1.0.0-rc.6

### SC-OPS-016 — A request that loses a race reads what the check says, not a server error

🟢 Two operators creating one key, a double click asking for a second draft, a cancellation arriving
after another: the platform checks before it writes, and where two requests pass that check
together the store decides. The one that loses is answered with the status, code and parameters a
request arriving a moment later gets from the check, rather than a 500 that reads like a crash in
the log. That holds for the writes the shipped stores guard this way — catalogue keys and drafts,
add-on cancellations, and the subscription's plan and cancellation — and for a store of an
integrator's own where it refuses with a `PersistenceRefusal`.

_Source:_ #352

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-prisma/tests/integration/persistence-contract.integration.test.js`
    - a create the store refuses
        - a marketing projection for a target and locale that has one is refused by code
        - a unique index of the application's own is not reported as a key taken
        - leaves the caller's transaction usable, where a failed insert would abort it
- `packages/core/tests/a-refused-write-names-what-it-found.test.js`
    - a write that lost a race names the case the check names
        - ${code} is refused as ${reason}, with what its message names
- `packages/nest/tests/a-request-that-loses-a-race-reads-what-the-check-says.test.js`
    - an operator who creates in the catalogue a moment after another
        - is told the plan key is taken, as the check says it
        - is told the bundle key is taken, as the check says it
        - is told the marketing projection exists, with the check’s 409
        - is told the plan has a draft, naming it
        - is told the plan is not found where it was retired in the meantime
        - is told the bundle has a draft, naming it
        - meets any other failure of the store unchanged
    - a tenant who cancels an add-on a moment after another request
        - is told it is already cancelled, as the check says it
        - is told it is not found where it went
    - a tenant whose subscription moves while the request is decided
        - cancelling a subscription gone meanwhile answers as the check does
        - an onboarding whose subscription went meanwhile answers as the check does, on the atomic
          path too
        - and any other failure of the atomic onboarding still reads as its own
        - an immediate plan change whose target lost its version answers as not found

<!-- END proof -->

### SC-OPS-008 — A scheduled job that has not run for months catches up in one step

🟢 Not one step per missed period, and not by walking forward one period at a time until it arrives
at today.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-009 — Periods advance when the operator's own job runs them, never behind their back

🟢 SaaSiCat decides what the next period should be; writing it is the integrator's scheduled job. An
installation that never runs it loses nothing it had — the next period is simply never opened.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-010 — An installation starts, or refuses; it does not start half-configured

🟢

_Source:_ `docs/reference/options.md`

### SC-OPS-011 — Dates are handled with their time zone stated, not inferred

🟢 Server time, browser time and the tenant's own time are three different things, and a billing date
is one of the places where confusing them costs money.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/maintenance-cli-flow.test.js`
    - times are read with their zone
        - a time without one is refused, naming the flag
        - an offset and a Z both name a moment
- `packages/ui-vue/tests/use-maintenance.test.js`
    - the times a form sends
        - what the input shows is read back as the same moment, with its zone

<!-- END proof -->

### SC-OPS-012 — An operator announces a maintenance window, and tenants see it before it begins

🟢 The operator gives a start, an expected end and, if they like, a message — in the
administration or from the command line — and can move the window or cancel it until it is locked.
From then on every tenant sees it above the application and on the sign-in page, in the viewer's
own time zone and language, with the message as the operator wrote it. An installation has one
open window at a time, so the next is announced once this one is over. No lead time is enforced,
because an emergency deploy has to lock at once, and an announced window whose end passes without a
lock is no longer shown. Mail is the application's: SaaSiCat tells it when a window is announced,
moved or cancelled, and the application writes to its own users in its own words and their language
(`SC-LANG-001`).

_Source:_ #329

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/maintenance-cli-flow.test.js`
    - announcing, moving and cancelling from the command line
        - an announcement needs both times
        - a second announcement is a conflict a script can branch on
        - moving and cancelling act on the open window, and refuse where none is
        - the status says what is announced, and what is locked
- `packages/nest/tests/a-maintenance-lock-refuses-tenant-requests.test.js`
    - the lock, on ${platform.name}
        - an announced window locks nobody out, and the status says it is coming
- `packages/nest/tests/a-maintenance-window-is-announced-locked-and-ended.test.js`
    - announcing a window
        - records it open, tells the application, and audits who announced it
        - a tenant is shown it from the moment it is announced
        - a second window is refused while one is open
        - its end has to be after its start — one millisecond is enough, none is not
        - an end that has already passed is refused, a start in the past is not
        - the message is kept as written, trimmed, and at most its limit long
        - a message of nothing but spaces is no message
    - moving and cancelling an announced window
        - moving it tells the application what it was and what it is now
        - a form saved as it was moves nothing, and tells nobody
        - a locked window saved with its own start is not refused for moving it
        - taking the message away is a change, leaving it out is not
        - a move that ends it before it starts is refused, and the window stays as it was
        - a window that is not the open one cannot be moved or cancelled
        - cancelling ends it without a lock, tells the application, and frees the slot
        - a cancelled window cannot be cancelled again
        - an announcement whose end passed without a lock is no longer shown to tenants
- `packages/ui-vue/tests/component/maintenance-page-and-lock-banner.test.ts`
    - MaintenancePage
        - with nothing open, it offers to announce a window or to lock at once
        - an announced window shows what tenants were told, and can be locked, moved or cancelled
        - an announcement whose end passed without a lock is flagged for cancelling
        - a locked window says since when, offers to unlock, and says so louder past its end
        - a resource of the application’s own that answers another shape does not take the page down
        - cancelling asks first, then cancels the window it is shown
    - moving a window in the dialog
        - saving only a new message sends only the message, however precise the window’s times
- `packages/ui-vue/tests/use-maintenance.test.js`
    - announcing, moving and cancelling
        - cancelling asks first and needs no code
        - a declined cancellation sends nothing
        - announcing sends the window and reads the windows again
        - a refused announcement rejects, so the form keeps what was typed and says why
- `packages/ui-vue-tenant/tests/component/a-locked-out-tenant-sees-one-page.test.ts`
    - the maintenance gate
        - with nothing announced, the application and nothing else
        - an installation that keeps no windows answers 404, and the application runs
        - a window ahead is announced above the application, with the operator’s message
        - while the lock holds, one page with the expected end — and no application behind it
        - past its announced end, it says it is taking longer
        - once the lock is lifted, the tenant is back on the screen it was on
        - a refused request switches to the page at once and says it was not carried out
        - a 503 that is not the lock’s — a proxy’s, say — is not taken for maintenance

<!-- END proof -->

### SC-OPS-013 — While the lock holds, no tenant request reaches the application

🟢 Every request is refused with `503`, the code `MAINTENANCE`, a `Retry-After` and the announced
end, before SaaSiCat's own checks read anything. Four things pass: the administration, the
maintenance status the tenant's pages read, a route the application marks as available during
maintenance — its health and readiness probes, say — and a platform administrator whose sign-in the
application has already established, so the operator can try the new version before letting tenants
back in. A payment provider's callback is refused like any other request and retried by the
provider, so that no write races the migration. SaaSiCat's own scheduled jobs skip their run while
the lock holds, and the application's ask `isLocked()` before theirs. Where it stops: the command
line does not go through HTTP and is not held; a guard the application registered globally before
SaaSiCat's runs first, so an authentication that reads its session from the database still does;
and a version starting inside the window runs its own start-up as usual.

_Source:_ #329

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-maintenance-lock-refuses-tenant-requests.test.js`
    - the lock, on ${platform.name}
        - without a lock a tenant request goes through, and its entitlements are read
        - while the lock holds › a tenant request is refused with 503, the code and when to try
          again
        - while the lock holds › a request nobody signed in to is refused for maintenance, not for
          its sign-in
        - while the lock holds › a route the application marks — its health probe — still answers
        - while the lock holds › the status a tenant’s page reads answers, to nobody in particular
        - while the lock holds › the administration answers the operator
        - while the lock holds › a platform administrator can try the application before letting
          tenants in
        - while the lock holds › past its announced end it says so, and asks the client back in a
          minute
- `packages/nest/tests/maintenance-is-wired-where-it-is-turned-on.test.js`
    - the platform’s own scheduled jobs
        - the promotional code sweep skips its run while the lock holds
        - and runs once it is unlocked, or where maintenance is off
        - the promotional code sweep runs under the RLS bypass, every step of it
        - and an installation hands the sweep its bypass, as the platform composes it
        - the expired sign-up cleanup skips its run while the lock holds
- `packages/nest/tests/the-administration-stays-reachable-during-maintenance.test.js`
    - the routes a maintenance lock lets through
        - the graph mounts the administration, the tenant routes and the status route
        - every controller of the administration passes
        - no other controller does, except the status a tenant’s page reads

<!-- END proof -->

### SC-OPS-014 — The lock begins and ends when somebody says so, not when the clock does

🟢 The deploy script, the command line or the administration locks and unlocks. The announced times
are what tenants are told and what `Retry-After` says; a lock that outlasts its announced end tells
tenants that it is taking longer than announced, rather than letting them back onto a half-migrated
schema, and the administration and `<app> doctor` report it so that a forgotten lock is found.
Locking what is locked, or unlocking what is not, reports the state that already holds
(`SC-OPS-007`).

_Source:_ #329

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/maintenance-cli-flow.test.js`
    - `maintenance off`
        - lets tenants back in, and says when there was nothing to unlock
    - `&lt;app&gt; doctor` about the lock
        - without maintenance turned on there is nothing to report
        - nothing open, or a window ahead, is fine
        - a lock is reported while it holds, and louder once its announced end has passed
        - an announcement whose end passed without a lock is named for cancelling
        - a table the lock cannot be read from is an error
- `packages/nest/tests/a-maintenance-lock-refuses-tenant-requests.test.js`
    - the lock, on ${platform.name}
        - once unlocked, tenants are back
- `packages/nest/tests/a-maintenance-window-is-announced-locked-and-ended.test.js`
    - locking and unlocking are the operator’s, not the clock’s
        - an announced window does not lock by itself when its start comes
        - locking takes the announced window, and it holds past its announced end
        - with nothing announced, locking opens a window that is locked at once
        - locking what is locked changes nothing and says so
        - a lock meant for a window that is no longer the open one is refused
        - a lock stating an end that has passed is refused
        - a lock that lands while this one is being written is reported as already held
        - a locked window keeps its start, and may still move its expected end
        - a locked window is ended by unlocking, not by cancelling
        - unlocking ends the window and lets tenants back in
        - an unlock that lost to another one does not end the lock a later deploy took
        - unlocking what is not locked changes nothing, and leaves an announcement standing
- `packages/ui-vue/tests/component/maintenance-page-and-lock-banner.test.ts`
    - MaintenancePage
        - a locked window says since when, offers to unlock, and says so louder past its end

<!-- END proof -->

### SC-OPS-015 — The lock survives a restart, and the version being replaced honours it too

🟢 It is kept in the application's database, in a table whose shape a deploy the lock protects does
not change, so the version being replaced and the one replacing it both read it, and a backup taken
inside the window restores with the lock on. Each process reads it at most a few seconds late, and
the command that locks returns only once every process has had that long, plus a grace for requests
already under way. It protects only a deploy whose running version already knows it: an installation
deploys the release that brings it once, normally, before its first locked deploy.

_Source:_ #329

<!-- BEGIN proof -->

_Tested by:_

- `packages/cli/tests/maintenance-cli-flow.test.js`
    - `maintenance on` returns once every process has seen the lock
        - it waits the time a process may keep an answer, plus the grace for requests under way
        - a grace of its own is waited instead, zero included
        - the wait starts once the lock is written, not at the moment the lock records
        - a lock that already held is waited for from this call too
        - a grace that is not a number of seconds is refused before anything is locked
- `packages/nest/tests/a-maintenance-window-is-announced-locked-and-ended.test.js`
    - what another process of the application makes of it
        - a lock reaches a process that asked before it, within the time it may keep an answer
        - an answer that took its time to arrive ages from when it was asked
        - an answer too old to act on when it arrives is asked for again
        - a lock is acted on however late its answer arrives
        - a read still on its way when this process locks does not undo the lock
        - a burst of requests after the answer aged asks the table once
        - a lock known to hold is not dropped because one read failed
        - a process that never read the lock lets requests through while the table cannot answer

<!-- END proof -->

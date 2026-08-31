---
title: Repeating an operation safely
---

Deployments fail and get retried; containers restart; a pipeline step is run again. This chapter
is written from the operator's side and says what they can repeat without holding their breath.
The requirement behind all of it: SaaSiCat keeps no ledger of which migrations have run, so every
one of them has to be safe to run twice.

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
    - handlePaymentEvent() duplicate webhook → ALREADY_PROCESSED + no second activation
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
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a shipped migration survives a second run
        - there are migrations to check
        - ${name} runs twice, and the second time changes nothing
    - a migration that would merge rows stops instead
        - two project keys stop it, and the message names them
        - and the installation is exactly as it was afterwards
        - one project key goes through

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
    - a migration that would merge rows stops instead
        - two project keys stop it, and the message names them
        - and the installation is exactly as it was afterwards
        - one project key goes through
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

- `packages/nest/tests/registration-service.test.js`
    - handlePaymentEvent() duplicate webhook → ALREADY_PROCESSED + no second activation

<!-- END proof -->

### SC-OPS-007 — Repeating an action a person took changes nothing either

🟢 Cancelling twice, accepting the same pending version twice, ending an already-ended contract —
each reports the state that already holds instead of creating a second effect.

_Source:_ release 1.0.0-rc.6

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

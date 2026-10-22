---
title: Cancelling
---

Cancelling is the part of a subscription a customer is most likely to dispute, so the rules are
written to be defensible rather than convenient. Two of them read backwards at first: a
cancellation may always be declared even when it cannot take effect soon, and a cancelled
subscription keeps everything until its date arrives.

### SC-CANC-001 — A cancellation may always be declared

🟢 The rules govern when it takes effect, not whether it may be made. A tenant is never told they may
not leave.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with no notice period, which is the default
        - a cancellation lands at the end of the term
        - the last day of the term is still in time

<!-- END proof -->

### SC-CANC-002 — A cancellation takes effect at the later of the period end and the commitment

🟢 💰 They coincide unless a notice period has pushed one past the other.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with no notice period, which is the default
        - a cancellation lands at the end of the term
        - the last day of the term is still in time
    - when the term and the period disagree
        - the later of the two decides
        - a subscription with no term at all falls back to the period

<!-- END proof -->

### SC-CANC-003 — A tenant cannot end a subscription on the spot

🟢 The tenant-facing route offers no immediate termination. Ending a contract on the spot is an
operator's act, through the operator's own path.

_Source:_ #212

### SC-CANC-004 — Where nothing is left to run, the cancellation lands now, never in the past

🟢 Deferring to a period end that has already gone would report a date the reader has to reason about
backwards.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - when nothing is left to run
        - a term already past lands the cancellation now
        - no dates at all is the same answer
- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a cancellation with nothing left to run
        - ends the subscription instead of leaving it active
        - and the date it lands on is the declaration itself
- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a cancellation that lands at once
        - ends the contract now, status and all
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a tenant still waiting on sales
        - cancels immediately, because nothing was ever committed
        - and one that did get a period keeps it

<!-- END proof -->

### SC-CANC-005 — There is no notice period until an installation names one

🟢 💰 Every installation states both numbers in `config/saas.yaml`, and one that states neither does
not start. Zero is what most should write: a cancellation declared on the last day of a period then
still takes effect at the end of that period, which is the reading a customer expects and the one
that generates no disputes. It is written down rather than defaulted, because a notice period is a
commercial decision and an unwritten one is a decision nobody made.

_Source:_ #212 · #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with no notice period, which is the default
        - a cancellation lands at the end of the term
        - the last day of the term is still in time

<!-- END proof -->

### SC-CANC-006 — A notice period belongs to a rhythm, not to an installation

🟢 💰 One number could not be right for both. A fortnight of notice on a yearly contract is unusual;
three months on a monthly one is void against a consumer in Germany. Each rhythm is configured
separately, and neither inherits the other — inferring one from the other would be inventing a
term. A configuration naming only one of them is therefore refused rather than read as zero for
the other; see
[SC-CFG-017](#sc-cfg-017--a-required-setting-is-required-member-by-member-not-as-a-block).

_Source:_ #230 · #217 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - which of the two numbers applies
        - a monthly subscription is owed the monthly notice
        - a yearly subscription is owed the yearly notice
        - an explicit zero is a zero, not an absence

<!-- END proof -->

### SC-CANC-007 — The rhythm that decides the notice is the subscription's, not the plan's

🟢 💰 A customer on a yearly subscription is owed the yearly notice, even where the same plan is also
sold monthly.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-follows-the-contracts-rhythm.test.js`
    - a notice follows the rhythm of the contract
        - one plan, two contracts, two deadlines
        - the yearly contract is owed the longer of the two
- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - which of the two numbers applies
        - a monthly subscription is owed the monthly notice
        - a yearly subscription is owed the yearly notice
        - an explicit zero is a zero, not an absence

<!-- END proof -->

### SC-CANC-025 — A cancellation is judged by the notice period its contract recorded

🔵 _(Superseded on 2026-10-22 by `SC-CANC-026`.)_
💰 A contract records the days of notice of its rhythm as
`config/saas.yaml#tenantBilling.cancellationNoticeDays` names them when it is concluded or changed,
and a cancellation of it is judged by those days, never by what the file names since: the
confirmation the subscriber keeps names the notice period (`SC-AUD-016`), and a file changed later
does not move the day a cancellation lands. Where the installation keeps no contracts, or no
contract is in force — nothing was confirmed —, the file's days for the subscription's rhythm
decide (`SC-CANC-007`).

_Source:_ #334 (decided 2026-10-18)

### SC-CANC-026 — A cancellation is judged by the notice period the subscriber agreed to

🟢 💰 A contract records the days of notice of its rhythm as
`config/saas.yaml#tenantBilling.cancellationNoticeDays` names them when the subscriber concludes or
changes it — a plan change, a booking, a switch they take. A change they schedule records the days
of the rhythm it ends in when they schedule it, and the contract written when it takes effect
records those, unless, in the same rhythm, they agreed to later days since. A successor the operator
or the platform writes without them — a feature withdrawal's reductions, a refresh, a retirement's
move at its date — keeps the days of the contract it replaces, in the same rhythm. A cancellation is
judged by the days of the contract in force, never by what the file names since: the confirmation the
subscriber keeps names the notice period (`SC-AUD-016`), and neither a file changed later nor a
change the subscriber did not make moves the day a cancellation lands. Where the installation keeps
no contracts, or no contract is in force — nothing was confirmed —, the file's days for the
subscription's rhythm decide (`SC-CANC-007`).

_Source:_ #334 (decided 2026-10-18; successors decided 2026-10-22)

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-bundle-booking-row-becomes-a-record.test.js`
    - a bundle booking row becomes a record
        - what was agreed by the booking and by the switch it scheduled is read from their columns
- `packages/core/tests/a-version-of-the-terms-is-kept-as-it-was-agreed.test.js`
    - what a scheduled change or a booking recorded as agreed
        - is read back as it was written, its terms none where none were named
        - is nothing where none was recorded, columns absent or null alike
        - ${what} stops the read, naming whose it is
        - is written in the columns of a scheduled change and of a booking, all null for none
- `packages/core/tests/canonical-rows-become-records.test.js`
    - a contract row becomes a contract record
        - its days of notice read as they were recorded, none included
        - when its terms were agreed reads as it was recorded, and a moment that is none stops the
          read
- `packages/nest/tests/a-booking-fits-every-plan-ahead.test.js`
    - a booking on a subscription set to move to another plan
        - records what booking it agrees to: the terms named and the notice of the plan’s rhythm
- `packages/nest/tests/a-contract-records-its-notice-period.test.js`
    - a contract records the notice period it is written with
        - concluded ${rhythm}, it records the days the file names for that rhythm
        - a successor records what the file names when it is written, and the contract it replaces
          keeps its own
        - a successor in another rhythm records the days of that rhythm
        - the start is refused without the settings it records them from, naming the setting
    - a cancellation is judged by the notice period its contract recorded
        - a contract that recorded fourteen days lands at this period end, though the file names
          ninety since
        - a contract that recorded ninety days is moved a period, though the file names fourteen
          since
        - a yearly subscription is held to its contract too, not to the yearly number of the file
        - without a contract in force, the file names the notice, as where no contracts are kept
        - the contract asked is the tenant’s own, in force when the cancellation is declared
    - the cancellation reads the contracts whichever module writes them
        - where tenant billing freezes them
        - where a checkout offer concludes them from the bundle, and no other module writes them
        - where a module beside tenant billing writes them, and nothing freezes them
        - where the store is named ${where} and not in the bundle
        - nowhere the installation keeps no contracts
- `packages/nest/tests/a-newer-add-on-version-is-taken.test.js`
    - one that takes something away is scheduled for the end of the booking’s term
        - with what scheduling it agrees to: the terms named and the notice of the plan’s rhythm,
          now
- `packages/nest/tests/a-reduction-is-written-into-the-contract.test.js`
    - the successor the reductions are written into
        - keeps the terms and the notice the subscriber agreed to, whatever the file names since
- `packages/nest/tests/a-subscriber-account-records-its-charges.test.js`
    - an add-on is charged even where writing its contract failed
        - the contract it writes records the latest of what the missed bookings were agreed under
- `packages/nest/tests/a-successor-records-what-the-subscriber-agreed-to.test.js`
    - a change the subscriber makes now
        - records what the file names now, whatever the contract it replaces recorded
    - a successor the operator or the platform writes
        - keeps what the contract it replaces records, the moment it was agreed included
        - in either spelling of the same rhythm
        - is refused in another rhythm, whose days of notice the contract does not hold
        - with no contract to keep from, records what the file names
    - a change the subscriber scheduled, written when it takes effect
        - records what they agreed to then, though the file names newer since
        - and so where the contract in force was agreed at the same moment
        - gives way to newer terms the subscriber agreed to since, with their notice
        - and, where the change moves the rhythm, to the newer terms with the notice of the rhythm
          it was scheduled in
        - with no contract in force, records what they agreed to then
- `packages/nest/tests/a-switch-taken-for-a-term-end-is-made.test.js`
    - the contract a switch taken for the end of the term is made in
        - records what the subscriber agreed to when they took it, and the schedule goes with it
- `packages/nest/tests/a-version-offer-is-taken.test.js`
    - one that takes something away is taken at the end of the term
        - with what taking it agrees to: the terms named and the notice of its rhythm, now
- `packages/nest/tests/an-operator-carries-a-vocabulary-into-running-contracts.test.js`
    - a refresh keeps what the subscriber agreed to
        - ${mode}, with the version of the terms and the days of notice of the contract it replaces
- `packages/nest/tests/pending-plan-materialization.test.js`
    - the contract a scheduled change ends in records what was agreed when it was scheduled, read
      before the write clears it
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - what the subscriber agreed to, on a contract a change writes
        - ${what} ${said}
- `packages/nest/tests/the-server-decides-when-a-change-lands.test.js`
    - a scheduled change records what scheduling it agrees to
        - the version of the terms named, the days of notice of the rhythm it lands in, and when
- `packages/nest/tests/the-terms-are-a-version-and-a-file.test.js`
    - a contract records the version of the terms the subscriber agreed to
        - a successor the operator writes keeps the version and the days of notice of the contract
          it replaces
        - and refuses to keep the days of one rhythm in a contract of another, writing nothing
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - a contract records the notice period it was concluded with
        - gives each contract the notice period of its rhythm, and comes out with the column
          required and checked
        - ends with the shape the reference schema has, nullability and check included
        - a second run needs neither number, and leaves every contract as the first one did
        - with ${what} set it refuses, saying how to set them, and fills nothing
        - a number that is ${what} stops it, and fills nothing
        - takes as many days as the column holds, the file setting no ceiling
        - more days than the column holds stop it, naming the ceiling, and fill nothing
        - a contract whose snapshot names no rhythm stops it, named, and nothing is filled
        - a table without contracts needs neither number, and comes out required
        - a role row-level security hides contracts from stops it, naming the table and the role

<!-- END proof -->

### SC-CANC-008 — No upper limit is placed on a notice period

🟢 The platform does not know whether an installation serves consumers or businesses, so the number
is the operator's to choose and the legal risk is theirs. What it costs is documented rather than
enforced.

_Source:_ #230 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - a year of notice on a yearly contract
        - is served by one step, because a year of period covers it

<!-- END proof -->

### SC-CANC-009 — A missed notice deadline moves the cancellation to the end of the next period

🟢 💰 A hard cut, not a grace period. It costs a customer real money, which is why the period a
cancellation lands in has to be stated before they confirm it.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - a cancellation that arrives after the notice window
        - buys the period the customer is billed for, to its day
        - and without a stored anchor keeps the old, shorter answer
        - while an on-time cancellation does not reach the step at all
- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with a notice period configured
        - before the window closes, nothing changes
        - on the deadline itself, still in time
        - one second later, a whole period later
        - a monthly term moves by a month, not by a year
- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a declaration made after the notice window closed
        - extends the stored commitment to the period it bought
        - so a plan change cannot be scheduled inside that period
- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - a notice shorter than the period behaves as it always did
        - declared in time, it ends with the period
        - declared too late, it ends one period on — which already serves it
        - the deadline is a real date, reachable by declaring earlier
        - no notice at all ends with the period, whenever it is declared
        - a term already over ends now, not at a date in the past

<!-- END proof -->

### SC-CANC-010 — A cancellation lands on the first period end that actually serves the notice

🟢 💰 However long the notice is. Advancing by exactly one period gave a customer between 31 and 60
days of a 60-day notice depending on which day they happened to declare — the operator promised
sixty and the customer received thirty-one. A misconfiguration should cost the customer a longer
wait, not cost the operator a promise the software cannot keep.

_Source:_ #230

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - with a notice period configured
        - before the window closes, nothing changes
        - on the deadline itself, still in time
        - one second later, a whole period later
        - a monthly term moves by a month, not by a year
- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - a notice longer than the period is served, not approximated
        - declaring on ${declaredOn} still buys 60 days
        - and it lands on a billing boundary, not sixty days from today
        - the anchor survives the extra steps
    - a port that does not store the billing day
        - the fallback day is read once, not at every step
        - and a single step is unaffected, which is why this hid so long
        - a stored anchor still wins over the fallback

<!-- END proof -->

### SC-CANC-011 — A late cancellation extends the recorded commitment to the period it bought

🟢 💰 Every other reader of the term end looks at the commitment, so a downgrade scheduled meanwhile
would otherwise land inside the period the customer had just paid for.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a cancellation inside a running term
        - leaves the subscription running
        - and does not touch the commitment
    - a declaration made after the notice window closed
        - extends the stored commitment to the period it bought
        - so a plan change cannot be scheduled inside that period

<!-- END proof -->

### SC-CANC-012 — Declaring the same cancellation twice does not move it

🟢 The second press reports the existing cancellation and writes nothing. Where a notice period is
configured, re-deciding after the deadline pushed an on-time declaration a whole period further
out: the customer pressed the same button twice and bought a year.

_Source:_ #212 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-declared-once.test.js`
    - cancelling twice does not move the date
        - the second request writes nothing and returns the first answer
        - a first cancellation still writes
- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a cancellation that was already recorded
        - is repaired on the next attempt rather than reported and left

<!-- END proof -->

### SC-CANC-013 — Two cancellations arriving at once produce one

🟢 The second one reads back what the first wrote rather than replacing an on-time date with one a
period later.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - two declarations arriving at once
        - the second one reports the first one rather than replacing it

<!-- END proof -->

### SC-CANC-014 — A repeated cancellation does not explain itself with figures it cannot know

🟢 The deadline and whether the declaration was late come back as unanswered rather than recomputed,
because recomputing them would report a declaration that landed a period late as an on-time one.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-declared-once.test.js`
    - what a repeat may say about the first cancellation
        - the date, and nothing it cannot know
        - while a first cancellation explains itself in full
    - a cancellation older than the fields that describe it
        - stops the renewal
        - and a repeat of it is recognised as one
- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a cancellation older than the fields that describe it
        - still reports when it lands
        - and an uncancelled subscription still reports nothing

<!-- END proof -->

### SC-CANC-015 — A tenant who has cancelled is told from which date

🟢 And the act they have already performed is no longer offered to them. A tenant who cancels in
month three of a year and sees only the word "cancelled" has lost nothing yet and believes they
have.

_Source:_ #219

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - confirming a cancellation that lands immediately
        - is not refused for having read the clock a moment earlier
        - but a date still in the future is refused
- `packages/ui-vue-tenant/tests/component/an-ended-subscription-reads-as-ended.test.ts`
    - a subscription that has ended
        - says so, in the past tense
        - and offers neither of the two acts it no longer has
    - a cancellation still to come
        - runs unchanged, and says that instead
        - and the plan can still be changed
    - a subscription with no cancellation
        - says nothing about one and offers both acts
    - a cancellation older than the fields that describe it
        - is read from the only column it has
    - a card left open across the moment
        - follows the boundary instead of the last render
        - reaches a boundary further away than one hop
        - and asks for no delay the platform would truncate
    - the page around the card
        - shows an ended subscription as cancelled, whatever its status column says
        - and a running one keeps its badge and its billing date
    - a cancellation that arrives after the page did
        - is measured from now, not from when the card was created

<!-- END proof -->

### SC-CANC-016 — A subscription is in one of three states, not two

🟢 Running; running with a cancellation still to come; over. The middle one is the one that gets
lost, and it keeps every entitlement it had until the date arrives. A page showing it follows the
effective moment on a timer rather than on the last render.

_Source:_ #219 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - what else ends when the subscription does
        - the frozen contract is ended on the same date
        - and a cancellation already recorded repairs its contract too
        - and a consumer without contracts is unaffected
- `packages/ui-vue-tenant/tests/component/a-cancelled-plan-still-runs.test.ts`
    - while nothing is cancelled
        - the tenant is offered the act
        - and told nothing about a cancellation
    - once it is cancelled
        - the date is shown, not just the word
        - and the subscription is described as unchanged until then
        - the act is no longer offered
        - changing plan still is
- `packages/ui-vue-tenant/tests/component/an-ended-subscription-reads-as-ended.test.ts`
    - a subscription that has ended
        - says so, in the past tense
        - and offers neither of the two acts it no longer has
    - a cancellation still to come
        - runs unchanged, and says that instead
        - and the plan can still be changed
    - a subscription with no cancellation
        - says nothing about one and offers both acts
    - a cancellation older than the fields that describe it
        - is read from the only column it has
    - a card left open across the moment
        - follows the boundary instead of the last render
        - reaches a boundary further away than one hop
        - and asks for no delay the platform would truncate
    - the page around the card
        - shows an ended subscription as cancelled, whatever its status column says
        - and a running one keeps its badge and its billing date
    - a cancellation that arrives after the page did
        - is measured from now, not from when the card was created

<!-- END proof -->

### SC-CANC-017 — The period a cancellation lands in is stated before the tenant confirms it

🟢 Not afterwards, and not on a receipt.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - confirming a cancellation that lands immediately
        - is not refused for having read the clock a moment earlier
        - but a date still in the future is refused

<!-- END proof -->

### SC-CANC-018 — The agreed contract ends when the subscription does, not when the customer declares

🟢 Both mistakes are available and both are wrong. Leaving it in force forever outlives the
agreement; ending it on declaration removes it from every lookup while the customer is still under
contract and still paying, so the invoicing side stops finding it.

_Source:_ #218 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a cancellation that lands at the end of the term
        - leaves the contract findable until that date
        - and not one moment past it
    - a cancellation that lands at once
        - ends the contract now, status and all
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - what else ends when the subscription does
        - the frozen contract is ended on the same date
        - and a cancellation already recorded repairs its contract too
        - and a consumer without contracts is unaffected

<!-- END proof -->

### SC-CANC-019 — Recording a cancellation is never blocked by something that follows it

🟢 If the contract could not be closed or the record of the act could not be written, the
cancellation still stands. A tenant is not left uncancelled because a secondary step failed.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - a cancellation inside a running term
        - leaves the subscription running
        - and does not touch the commitment
- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - a tenant with no contract at all
        - is not an error

<!-- END proof -->

### SC-CANC-020 — An ended subscription leaves the tenant a period to read and export before its deletion

🟡 _(Decided, not yet delivered.)_ 🔒 A subscription that ends while still a trial, with no contract
ever frozen (`SC-SPEC-005`), ends the same way. The period is named in `config/saas.yaml`. Every
subscription that ends has one deletion date, recorded and told to the tenant. A cancellation the
tenant confirmed carries the date announced at confirmation (`SC-CANC-021`); a subscription that
ends without one, by a trial running out or by an operator ending it on the spot (`SC-CANC-003`),
gets its date computed from the period at the moment it ends. A later change to the period moves
neither, and the one way to delete earlier is `SC-ADM-020`'s. A new subscription for the tenant
before that date lifts it, and that subscription ending records a date of its own. What a tenant may
do during the period is `SC-ADM-024`'s to enforce, and how the deletion runs is `SC-PRIV-014`'s.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-CANC-021 — The read-only period and the deletion date are stated before a tenant cancels

🟡 _(Decided, not yet delivered.)_ 🔒 Beside the period the cancellation lands in, which
`SC-CANC-017` states. The deletion date stated when the tenant confirms is recorded with the
cancellation, and a later change to the period in `config/saas.yaml` applies to cancellations
confirmed after it, never moving a date already announced. The one way a tenant is deleted before
that date is an early deletion the operator confirms for a legal reason (`SC-ADM-020`).

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-CANC-022 — A tenant is reminded before its data is deleted

🟡 _(Decided, not yet delivered.)_ 🔒 By email to the tenant's administrators, who can take the export
(`SC-PRIV-017`), at each lead time `config/saas.yaml` names in days before the deletion date
(`SC-CANC-020`). Lead times that have already passed when the subscription ends are covered by one
reminder sent at once rather than skipped, so a period shorter than a lead time still gives notice,
and a run that repeats sends no reminder twice. Each reminder sent is part of the deletion record
(`SC-PRIV-017`).

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

### SC-CANC-023 — A plan retirement lets a subscription cancel without notice until it takes effect

🟢 💰 Neither the notice period nor a minimum term holds it: those are the terms the operator is
changing. A cancellation declared by the last day the notice names lands at the end of the period
running, and the page states that date before the customer confirms. Once the subscription has left
the retired version — a newer version taken — or the retirement has taken effect, notice and term
apply again.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-lets-a-subscriber-leave-without-notice.test.js`
    - a subscription a retirement reaches
        - is shown the retirement it was told of
        - is offered to leave at the end of the period it is in, without notice or minimum term
        - is cancelled for that date when it confirms
        - once the retirement has taken effect, owes notice and term again
- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - the retirement that reaches a subscription
        - is what the subscriber was told, until it takes effect
        - is none once the subscription has left the retired version
        - is none while its notice has reached nobody, and the notice once it has
        - is none for a subscription told only of an offer

<!-- END proof -->

### SC-CANC-024 — While a feature it holds is withdrawn, a subscription may end at once

🟢 💰 Without notice, at the moment the tenant's administrator declares it, for as long as the feature
is missing — also where the subscription is already cancelled for a later date, provided the
application's subscription store can end it early; where it cannot, the refusal says so and the
cancellation stands. Before confirming, the tenant reads what ends and what is credited
(`SC-PRIC-075`). Every add-on ends with the subscription. Nobody else in the tenant may end it, and
a subscription the withdrawal did not reach, or one that has ended, is refused with its code. Nobody
is reminded: doing nothing costs the subscriber nothing, because the reduction applies by itself
(`SC-PRIC-073`).

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-ends-at-once.test.js`
    - what the tenant sees of a withdrawal
        - says what is reduced, and what may end at once
        - opens nothing before the date, and is gone once the withdrawal is lifted
        - ends the reduction with a change of plan or rhythm, and the right with the feature
        - says when a line a scheduled change brings begins, and reduces it once it runs
        - reduces the line held until the change, and the line it brings from then
        - says when the scheduled move of a booking brings the version that grants the feature
        - shows nothing to a subscription it did not reach
    - ending a subscription at once
        - ends it now, records it first, ends the contract and credits the unused rest
        - brings forward a cancellation declared for the end of the term
        - is refused, and nothing recorded, where the store cannot bring a declared end forward
        - is refused the same where the store names its end-now write as null
        - is refused as one that cannot be brought forward where only the declaration date names the
          end
        - is refused for a withdrawal it was not told of, or one not in effect now
        - is refused once it has ended, and where the plan no longer grants the feature
        - is open to a subscription reached through its special terms alone
        - a second attempt after a failure ends at its own moment, not the failed one
        - is refused where the cancellation moved meanwhile
        - shows what it would credit first, refused as the end would be
- `packages/nest/tests/an-operator-withdraws-a-feature.test.js`
    - an end at once, sent by the run
        - is told where the subscription or the booking ended at its moment, and never where the end
          failed
- `packages/ui-vue/tests/a-tenant-is-told-of-a-withdrawn-feature.test.js`
    - ending at once
        - asks what the subscription would credit, and ends it, under the prefix given
        - ends one booking by its own path
        - a refused end is thrown to the card, and nothing is read again
    - reading the withdrawals again when one changes
        - reads them again once the withdrawal takes effect, and offers what opens then
        - reads them again once the withdrawal is lifted, and offers nothing more
        - reads them again once a scheduled change brings the line, and offers what opens then
        - asks again soon where the server has not reached the moment yet
        - reads nothing more once the page is gone
- `packages/ui-vue-tenant/tests/component/a-withdrawn-feature-is-told-beside-the-plan.test.ts`
    - ending at once while a feature is withdrawn
        - names what ends and what is credited before the click, and ends it on confirmation
        - ends one add-on by name, and says when nothing is credited
        - keeps each plan line its own when the list is read again after an end
        - a refused question says why and offers no confirmation
    - the page of the tenant’s add-ons
        - tells of the withdrawal too, and reads the bookings again once one ended at once

<!-- END proof -->

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
    - a cancellation lands at the end of the term
    - the last day of the term is still in time
    - before the window closes, nothing changes
    - on the deadline itself, still in time
    - one second later, a whole period later
    - a monthly term moves by a month, not by a year
    - the later of the two decides
    - a subscription with no term at all falls back to the period
    - a term already past lands the cancellation now
    - no dates at all is the same answer
    - 31 January plus a month is the end of February
    - and in a leap year, the 29th
    - 31 March plus a month is 30 April
    - 29 February plus a year is 28 February
    - a day that exists in both months is untouched
    - December rolls into the next year
    - the cancellation lands when the trial does
    - a notice period does not buy a billing cycle
    - and a paid term five days out still does
    - a trial with no dates at all still lands now

<!-- END proof -->

### SC-CANC-002 — A cancellation takes effect at the later of the period end and the commitment

🟢 They coincide unless a notice period has pushed one past the other.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a cancellation lands at the end of the term
    - the last day of the term is still in time
    - before the window closes, nothing changes
    - on the deadline itself, still in time
    - one second later, a whole period later
    - a monthly term moves by a month, not by a year
    - the later of the two decides
    - a subscription with no term at all falls back to the period
    - a term already past lands the cancellation now
    - no dates at all is the same answer
    - 31 January plus a month is the end of February
    - and in a leap year, the 29th
    - 31 March plus a month is 30 April
    - 29 February plus a year is 28 February
    - a day that exists in both months is untouched
    - December rolls into the next year
    - the cancellation lands when the trial does
    - a notice period does not buy a billing cycle
    - and a paid term five days out still does
    - a trial with no dates at all still lands now

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

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - ends the subscription instead of leaving it active
    - and the date it lands on is the declaration itself
    - is not refused for having read the clock a moment earlier
    - but a date still in the future is refused
    - leaves the subscription running
    - and does not touch the commitment
    - still reports when it lands
    - and an uncancelled subscription still reports nothing
    - extends the stored commitment to the period it bought
    - so a plan change cannot be scheduled inside that period

<!-- END proof -->

### SC-CANC-005 — There is no notice period until an installation names one

🟢 Every installation states both numbers in `config/saas.yaml`, and one that states neither does not
start. Zero is what most should write: a cancellation declared on the last day of a period then
still takes effect at the end of that period, which is the reading a customer expects and the one
that generates no disputes. It is written down rather than defaulted, because a notice period is a
commercial decision and an unwritten one is a decision nobody made.

_Source:_ #212 · #217

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - declaring on ${declaredOn} still buys 60 days
    - and it lands on a billing boundary, not sixty days from today
    - the anchor survives the extra steps
    - the fallback day is read once, not at every step
    - and a single step is unaffected, which is why this hid so long
    - a stored anchor still wins over the fallback
    - declared in time, it ends with the period
    - declared too late, it ends one period on — which already serves it
    - the deadline is a real date, reachable by declaring earlier
    - no notice at all ends with the period, whenever it is declared
    - a term already over ends now, not at a date in the past
    - is served by one step, because a year of period covers it
    - a monthly subscription is owed the monthly notice
    - a yearly subscription is owed the yearly notice
    - an explicit zero is a zero, not an absence

<!-- END proof -->

### SC-CANC-006 — A notice period belongs to a rhythm, not to an installation

🟢 One number could not be right for both. A fortnight of notice on a yearly contract is unusual;
three months on a monthly one is void against a consumer in Germany. Each rhythm is configured
separately, and neither inherits the other — inferring one from the other would be inventing a
term. A configuration naming only one of them is therefore refused rather than read as zero for
the other; see
[SC-CFG-017](#sc-cfg-017--a-required-setting-is-required-member-by-member-not-as-a-block).

_Source:_ #230 · #217 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - declaring on ${declaredOn} still buys 60 days
    - and it lands on a billing boundary, not sixty days from today
    - the anchor survives the extra steps
    - the fallback day is read once, not at every step
    - and a single step is unaffected, which is why this hid so long
    - a stored anchor still wins over the fallback
    - declared in time, it ends with the period
    - declared too late, it ends one period on — which already serves it
    - the deadline is a real date, reachable by declaring earlier
    - no notice at all ends with the period, whenever it is declared
    - a term already over ends now, not at a date in the past
    - is served by one step, because a year of period covers it
    - a monthly subscription is owed the monthly notice
    - a yearly subscription is owed the yearly notice
    - an explicit zero is a zero, not an absence

<!-- END proof -->

### SC-CANC-007 — The rhythm that decides the notice is the subscription's, not the plan's

🟢 A customer on a yearly subscription is owed the yearly notice, even where the same plan is also
sold monthly.

_Source:_ `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - declaring on ${declaredOn} still buys 60 days
    - and it lands on a billing boundary, not sixty days from today
    - the anchor survives the extra steps
    - the fallback day is read once, not at every step
    - and a single step is unaffected, which is why this hid so long
    - a stored anchor still wins over the fallback
    - declared in time, it ends with the period
    - declared too late, it ends one period on — which already serves it
    - the deadline is a real date, reachable by declaring earlier
    - no notice at all ends with the period, whenever it is declared
    - a term already over ends now, not at a date in the past
    - is served by one step, because a year of period covers it
    - a monthly subscription is owed the monthly notice
    - a yearly subscription is owed the yearly notice
    - an explicit zero is a zero, not an absence

<!-- END proof -->

### SC-CANC-008 — No upper limit is placed on a notice period

🟢 The platform does not know whether an installation serves consumers or businesses, so the number
is the operator's to choose and the legal risk is theirs. What it costs is documented rather than
enforced.

_Source:_ #230 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-notice-period-fits-its-cycle.test.js`
    - declaring on ${declaredOn} still buys 60 days
    - and it lands on a billing boundary, not sixty days from today
    - the anchor survives the extra steps
    - the fallback day is read once, not at every step
    - and a single step is unaffected, which is why this hid so long
    - a stored anchor still wins over the fallback
    - declared in time, it ends with the period
    - declared too late, it ends one period on — which already serves it
    - the deadline is a real date, reachable by declaring earlier
    - no notice at all ends with the period, whenever it is declared
    - a term already over ends now, not at a date in the past
    - is served by one step, because a year of period covers it
    - a monthly subscription is owed the monthly notice
    - a yearly subscription is owed the yearly notice
    - an explicit zero is a zero, not an absence

<!-- END proof -->

### SC-CANC-009 — A missed notice deadline moves the cancellation to the end of the next period

🟢 A hard cut, not a grace period. It costs a customer real money, which is why the period a
cancellation lands in has to be stated before they confirm it.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a cancellation lands at the end of the term
    - the last day of the term is still in time
    - before the window closes, nothing changes
    - on the deadline itself, still in time
    - one second later, a whole period later
    - a monthly term moves by a month, not by a year
    - the later of the two decides
    - a subscription with no term at all falls back to the period
    - a term already past lands the cancellation now
    - no dates at all is the same answer
    - 31 January plus a month is the end of February
    - and in a leap year, the 29th
    - 31 March plus a month is 30 April
    - 29 February plus a year is 28 February
    - a day that exists in both months is untouched
    - December rolls into the next year
    - the cancellation lands when the trial does
    - a notice period does not buy a billing cycle
    - and a paid term five days out still does
    - a trial with no dates at all still lands now

<!-- END proof -->

### SC-CANC-010 — A cancellation lands on the first period end that actually serves the notice

🟢 However long the notice is. Advancing by exactly one period gave a customer between 31 and 60 days
of a 60-day notice depending on which day they happened to declare — the operator promised sixty
and the customer received thirty-one. A misconfiguration should cost the customer a longer wait,
not cost the operator a promise the software cannot keep.

_Source:_ #230

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a cancellation lands at the end of the term
    - the last day of the term is still in time
    - before the window closes, nothing changes
    - on the deadline itself, still in time
    - one second later, a whole period later
    - a monthly term moves by a month, not by a year
    - the later of the two decides
    - a subscription with no term at all falls back to the period
    - a term already past lands the cancellation now
    - no dates at all is the same answer
    - 31 January plus a month is the end of February
    - and in a leap year, the 29th
    - 31 March plus a month is 30 April
    - 29 February plus a year is 28 February
    - a day that exists in both months is untouched
    - December rolls into the next year
    - the cancellation lands when the trial does
    - a notice period does not buy a billing cycle
    - and a paid term five days out still does
    - a trial with no dates at all still lands now

<!-- END proof -->

### SC-CANC-011 — A late cancellation extends the recorded commitment to the period it bought

🟢 Every other reader of the term end looks at the commitment, so a downgrade scheduled meanwhile
would otherwise land inside the period the customer had just paid for.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - ends the subscription instead of leaving it active
    - and the date it lands on is the declaration itself
    - is not refused for having read the clock a moment earlier
    - but a date still in the future is refused
    - leaves the subscription running
    - and does not touch the commitment
    - still reports when it lands
    - and an uncancelled subscription still reports nothing
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
    - the second request writes nothing and returns the first answer
    - a first cancellation still writes
    - the date, and nothing it cannot know
    - while a first cancellation explains itself in full
    - stops the renewal
    - and a repeat of it is recognised as one

<!-- END proof -->

### SC-CANC-013 — Two cancellations arriving at once produce one

🟢 The second one reads back what the first wrote rather than replacing an on-time date with one a
period later.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-declared-once.test.js`
    - the second request writes nothing and returns the first answer
    - a first cancellation still writes
    - the date, and nothing it cannot know
    - while a first cancellation explains itself in full
    - stops the renewal
    - and a repeat of it is recognised as one

<!-- END proof -->

### SC-CANC-014 — A repeated cancellation does not explain itself with figures it cannot know

🟢 The deadline and whether the declaration was late come back as unanswered rather than recomputed,
because recomputing them would report a declaration that landed a period late as an on-time one.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-declared-once.test.js`
    - the second request writes nothing and returns the first answer
    - a first cancellation still writes
    - the date, and nothing it cannot know
    - while a first cancellation explains itself in full
    - stops the renewal
    - and a repeat of it is recognised as one

<!-- END proof -->

### SC-CANC-015 — A tenant who has cancelled is told from which date

🟢 And the act they have already performed is no longer offered to them. A tenant who cancels in
month three of a year and sees only the word "cancelled" has lost nothing yet and believes they
have.

_Source:_ #219

### SC-CANC-016 — A subscription is in one of three states, not two

🟢 Running; running with a cancellation still to come; over. The middle one is the one that gets
lost, and it keeps every entitlement it had until the date arrives. A page showing it follows the
effective moment on a timer rather than on the last render.

_Source:_ #219 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - can still cancel, and lands at the same date as anybody else
    - cancels immediately, because nothing was ever committed
    - and one that did get a period keeps it
    - the ending wins, exactly at the moment they meet
    - and a minute earlier the change still happens
    - does not roll onto a subscription whose term is over
    - while a cancellation still to come stops nothing
    - and an uncancelled subscription rolls as before
    - is refused on the atomic path, which is the preferred one
    - while a running subscription is activated as before
    - and the write carries what the route read, so a late cancellation wins
    - is refused rather than recorded against a dead contract
    - while a running subscription accepts as before
    - the frozen contract is ended on the same date
    - and a cancellation already recorded repairs its contract too
    - and a consumer without contracts is unaffected

<!-- END proof -->

### SC-CANC-017 — The period a cancellation lands in is stated before the tenant confirms it

🟢 Not afterwards, and not on a receipt.

_Source:_ #212

### SC-CANC-018 — The agreed contract ends when the subscription does, not when the customer declares

🟢 Both mistakes are available and both are wrong. Leaving it in force forever outlives the
agreement; ending it on declaration removes it from every lookup while the customer is still under
contract and still paying, so the invoicing side stops finding it.

_Source:_ #218 · release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-ends-when-the-subscription-does.test.js`
    - leaves the contract findable until that date
    - and not one moment past it
    - ends the contract now, status and all
    - is not an error
    - inherits the ending rather than starting open
    - while a subscription with no ending freezes open, as before
    - is repaired on the next attempt rather than reported and left

<!-- END proof -->

### SC-CANC-019 — Recording a cancellation is never blocked by something that follows it

🟢 If the contract could not be closed or the record of the act could not be written, the
cancellation still stands. A tenant is not left uncancelled because a secondary step failed.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-writes-what-it-decided.test.js`
    - ends the subscription instead of leaving it active
    - and the date it lands on is the declaration itself
    - is not refused for having read the clock a moment earlier
    - but a date still in the future is refused
    - leaves the subscription running
    - and does not touch the commitment
    - still reports when it lands
    - and an uncancelled subscription still reports nothing
    - extends the stored commitment to the period it bought
    - so a plan change cannot be scheduled inside that period

<!-- END proof -->

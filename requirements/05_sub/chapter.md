---
title: Subscriptions, terms and billing periods
---

This chapter is about time: when a term starts, how long it runs, which day of the month a tenant
is billed on, and what renews without anybody doing anything. Most of it is invisible while it
works. It is here because the one case where it did not work — a billing day quietly moving to the
28th and staying there — moved every other date with it.

### SC-SUB-001 — A tenant has one subscription

🟢

_Source:_ `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/spec/tests/reference-sql-drift.test.js`
    - the reference schema makes one subscription per tenant impossible to break

<!-- END proof -->

### SC-SUB-002 — The minimum term is the billing period that was chosen, and it starts at activation

🟢 💰 Monthly or yearly. There is no third rhythm, and no commitment separate from the period unless
an operator configures one for an add-on.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - when the term and the period disagree
        - the later of the two decides
        - a subscription with no term at all falls back to the period

<!-- END proof -->

### SC-SUB-003 — A term renews by itself unless it was cancelled first

🟢 💰 The commitment renews with the period, because the commitment is the period.

_Source:_ #212

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-renewal.test.js`
    - computeNextPeriod
        - a declared cancellation does not stop the period from rolling
        - a landed cancellation does
        - the renewed period is also the renewed commitment
        - null when currentPeriodEnd null (Trial)
        - null when currentPeriodEnd is in the future
        - rolls MONTHLY period +1 month (daily cron, periodEnd 1 day before now)
        - rolls YEARLY period +1 year
        - cron lag: with several missed periods, jumps to the next future period

<!-- END proof -->

### SC-SUB-004 — A short month does not move the billing day

🟢 💰 A subscription billed on the 31st is billed on 28 February and then on 31 March. One billed on
the 30th is billed on the 30th of October, not the 31st: the day is "the 30th", not "the end of the
month". Reading the next date off the previous one let a single February move a tenant's billing day
permanently three days earlier, and every date derived from it moved too — the renewal, the notice
deadline, and the end date the customer was told about.

_Source:_ #220 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - a subscription billed on the 31st
        - comes back to the 31st after February
        - and without an anchor it never comes back — the case this exists for
    - a subscription billed on the 30th
        - is billed on the 30th in a 31-day month
        - and on the 28th in February, then back to the 30th
    - a yearly subscription starting on a leap day
        - is billed on the 28th in ordinary years and the 29th when one comes round
    - a renewal that has already been through a February
        - rolls back onto the day the customer is billed on
        - and without a stored anchor keeps the day it landed on
    - a yearly subscription billed on the 31st
        - stays on the 31st, because the month is the same one every year
- `packages/nest/tests/a-cancellation-lands-at-the-term-end.test.js`
    - a period boundary on a month end stays on a month end
        - 31 January plus a month is the end of February
        - and in a leap year, the 29th
        - 31 March plus a month is 30 April
        - 29 February plus a year is 28 February
        - a day that exists in both months is untouched
        - December rolls into the next year

<!-- END proof -->

### SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal

🟢 💰 Reading its own previous result is precisely the drift it exists to stop.

_Source:_ #220

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - iterating to the next boundary
        - keeps the anchor across every step it takes
        - and reaches the anchor day itself where the month is long enough
        - and an explicit anchor overrides the start it was given
    - a renewal that has already been through a February
        - rolls back onto the day the customer is billed on
        - and without a stored anchor keeps the day it landed on
    - a subscription billed on an ordinary day
        - is billed on that day in every month, long or short
        - and the first of the month is not confused with the last of the one before
    - a plan change reopens the window
        - and the day the customer is billed on moves with it
    - an anchor that cannot be a day of a month
        - ${impossible} is treated as absent, not as a day
        - while a possible one is used
    - an impossible anchor handed to the iteration
        - is treated as absent for the whole walk, not for each step
- `packages/nest/tests/version-renewal.test.js`
    - computeNextPeriod
        - a declared cancellation does not stop the period from rolling
        - a landed cancellation does
        - the renewed period is also the renewed commitment
        - null when currentPeriodEnd null (Trial)
        - null when currentPeriodEnd is in the future
        - rolls MONTHLY period +1 month (daily cron, periodEnd 1 day before now)
        - rolls YEARLY period +1 year
        - cron lag: with several missed periods, jumps to the next future period

<!-- END proof -->

### SC-SUB-006 — Billing dates do not move when the clock does

🟢 Period boundaries are computed so that a daylight-saving change cannot shift a billing date by a
day.

_Source:_ release 1.0.0-rc.7

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/billing-period.test.js`
    - initialPeriodWindow MONTHLY — exactly 1 month
    - initialPeriodWindow YEARLY — exactly 1 year
    - initialPeriodWindow DST transition — UTC-stable
    - periodEndAfter MONTHLY — next period after now
    - periodEndAfter YEARLY — skips multiple years
    - periodEndAfter with null startedAt — iterate from now
    - periodEndWithMinLead YEARLY with ≥42d lead — directly currentPeriodEnd
    - periodEndWithMinLead MONTHLY with &lt;42d lead — skips period
    - periodEndWithMinLead — minLeadDays configurable (14d, accepts exactly 14d)
    - periodEndWithMinLead — minLeadDays 15d on same date jumps to next period

<!-- END proof -->

### SC-SUB-007 — A subscription with no period does not renew

🟢 A trial, or a subscription still waiting on a negotiated contract, has nothing to roll forward.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/version-renewal.test.js`
    - decideRenewal
        - SKIP when no pending version
        - SKIP when EffectiveAt is in the future
        - ROLL_FORWARD when nonRegressive=true
        - ROLL_FORWARD when accepted=true (even if regressive)
        - CLEAR_PENDING when regressive + not accepted (variant B)

<!-- END proof -->

### SC-SUB-008 — A declared cancellation does not stop the renewal until it lands

🟢 💰 Where a notice period pushed the ending into the following period, that period has to exist
before it can end.

_Source:_ release 1.0.0-rc.6

### SC-SUB-009 — A tenant in arrears can still cancel

🟢 💰 A tenant whose payment failed wanting out is the single most important cancellation there is,
and a status check placed one line too early would refuse it.

_Source:_ #218

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a tenant whose payment failed
        - can still cancel, and lands at the same date as anybody else

<!-- END proof -->

### SC-SUB-010 — A subscription that has ended can no longer change plan

🟢 Nor complete onboarding, accept a pending version, or book an add-on.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - activating a subscription that has already ended
        - is refused on the atomic path, which is the preferred one
        - while a running subscription is activated as before
        - and the write carries what the route read, so a late cancellation wins

<!-- END proof -->

### SC-SUB-011 — A subscription with nothing left to run is recorded as ended

🟢 Rather than left looking active for good, because nothing downstream would ever have moved it.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - activating a subscription that has already ended
        - is refused on the atomic path, which is the preferred one
        - while a running subscription is activated as before
        - and the write carries what the route read, so a late cancellation wins

<!-- END proof -->

### SC-SUB-012 — A new version of a plan does not move a customer who already bought one

🟢 It is offered as a pending change instead. A change that only improves things takes effect at the
next renewal; one that takes something away only takes effect if the tenant accepted it, and is
otherwise dropped when its date arrives.

_Source:_ release 1.0.0-rc.6 · `docs/explanation/data-model.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a plan version published before the customer left
        - does not roll onto a subscription whose term is over
        - while a cancellation still to come stops nothing
        - and an uncancelled subscription rolls as before
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - the plan line records the version the subscription is bound to
        - a tenant on v1 who books an add-on after v2 is published keeps v1

<!-- END proof -->

### SC-SUB-013 — Nothing rolls forward onto a subscription whose cancellation has landed

🟢 A version becomes due because a date arrived, not because anybody still wants it.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a subscription that has ended
        - refuses a plan change instead of charging for one
        - while a running one still changes plans
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a plan version published before the customer left
        - does not roll onto a subscription whose term is over
        - while a cancellation still to come stops nothing
        - and an uncancelled subscription rolls as before

<!-- END proof -->

### SC-SUB-014 — Accepting the same pending version twice changes nothing

🟢 And accepting one when none is pending is refused rather than silently accepted.

_Source:_ `docs/reference/error-codes.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - accepting a version after the subscription ended
        - is refused rather than recorded against a dead contract
        - while a running subscription accepts as before
- `packages/nest/tests/version-renewal.test.js`
    - clearPendingPlanVersionFields
        - returns all pending fields as null/false

<!-- END proof -->

### SC-SUB-015 — A scheduled change that comes due after the customer has left is declined and recorded

🟢 A change that never happened is something an operator may be asked about later.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - a change scheduled before the customer cancelled
        - is declined once the cancellation has taken effect
        - but a cancellation still to come declines nothing
        - and an uncancelled subscription is applied as before
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - accepting a version after the subscription ended
        - is refused rather than recorded against a dead contract
        - while a running subscription accepts as before
- `packages/nest/tests/pending-plan-materialization.test.js`
    - materializes all due pending plan changes and invalidates each tenant
    - defaults to MONTHLY cycle when pendingBillingCycle is null
    - is non-fatal per tenant — one failure does not abort the run
    - no-op when nothing is due

<!-- END proof -->

### SC-SUB-016 — A subscription always has its subscriber, whichever path created the tenant

🟢 💰 Self-registration creates both together (`SC-REG-022`), and
a tenant an operator creates through the administration, a command or the integrator's own form
(`SC-SCOPE-006`) gets its subscriber in the same step, so no contract is ever frozen and no
charge ever arises without a party to it.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-is-concluded-with-its-subscriber.test.js`
    - no contract arises without its subscriber
        - a contract for a tenant without one is refused, and nothing is written
        - replacing the contract in force is refused before that contract is closed
        - a frozen contract is refused before the one in force is closed
    - a change that ends in a contract asks for the subscriber before it is written
        - a plan change is refused, and no plan is written
        - booking an add-on is refused, and nothing is booked
        - reactivating one is refused as well, being a purchase again
        - while cancelling one is not refused: a cancellation is a declaration
    - a completed sign-up names its subscriber from what it collected
        - the registered name as the legal name, the verified address for invoices, and the billing
          details of step 4
- `packages/nest/tests/an-offer-is-concluded-with-its-contract.test.js`
    - the party an offer is concluded with
        - a subscriber passed in is created on the transaction, before the contract that names it
        - a failure after it undoes the subscriber with the contract, and the next attempt creates
          one
        - a tenant with no subscriber and none passed in is refused before anything is written
        - a subscriber passed in for a tenant that has one is refused before anything is written
        - a subscriber without a legal name is refused before anything is written
        - a retry after the conclusion answers with it and creates no second subscriber
- `packages/nest/tests/subscription-contract-freeze-service.test.js`
    - a tenant without a subscriber is refused before the contract in force is closed
- `packages/spec/tests/integration/a-migration-survives-a-second-run.integration.test.js`
    - every contract names the subscriber it is concluded with
        - every tenant with a subscription or a contract gets one subscriber, named from its own
          table, in the order it came

<!-- END proof -->

### SC-SUB-017 — A subscriber's legal identity can be corrected, not replaced, under a running contract

🟡 _(Decided, not yet delivered.)_ 💰 Contact details, such as the address or the invoice email,
can be changed at any time, and later invoices carry the new ones. The legal name and the tax
identifiers are the party the contract was concluded with (`SC-AUD-012`). While a contract runs
they change only as a correction of that same party, such as a misspelt name, a wrong tax
identifier or a change of name the same legal entity went through, which the operator records
with the values it replaces and the reason (`SC-ADM-020`); later invoices carry the corrected
identity, and the contract keeps its copy as concluded. SaaSiCat cannot tell a correction from
another legal entity taking over, so the operator declares which it is: a takeover is a transfer
or a new contract rather than an edit, the same rule `SC-PRIC-026` applies to the issuer.

_Source:_ #276 · `docs/explanation/adr/0012-the-subscriber-owns-the-commercial-record.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-contract-is-concluded-with-its-subscriber.test.js`
    - a contract names the parties it is concluded with
        - a later correction of the subscriber leaves the copy on the contract
- `packages/nest/tests/a-subscriber-identity-is-corrected-not-replaced.test.js`
    - contact details
        - change at any time: what is named is written, null clears, the rest is kept
        - do not include ${field}, which is refused rather than dropped
    - a correction of the legal identity
        - writes the corrected values and records the ones it replaced, why, and by whom
        - declared as another legal entity taking over is refused, and nothing changes
        - ${what} is refused, and nothing is recorded
        - of a subscriber that does not exist is refused as not found
- `packages/nest/tests/a-tenant-keeps-its-billing-details.test.js`
    - the tenant changes how it is reached
        - what it names is written, settled as every detail is, and the rest is kept
        - only the session's tenant is changed
        - the ${field} can be changed but not cleared, and a refused change writes nothing
        - the second address line can be cleared: an invoice does not need it
        - a ${field} not in its form is refused by name
        - a value that is not text never reaches the service
        - the ${field} reaches the service through the pipe and is refused there, not dropped

<!-- END proof -->

### SC-SUB-018 — A tenant can change the address and email it is billed at, but not clear them

🟢 💰 A user holding the billing permission (`SC-UI-023`) changes the subscriber's address and
invoice email in the tenant's billing area; later invoices carry the new ones (`SC-SUB-017`). The
street, postal code, city, country and invoice email are what sign-up asked for and what an invoice
cannot be sent without (`SC-PRIC-032`), so a change can replace them and is refused where it would
leave one empty. The legal name and the tax identifiers are refused there by name, not dropped: the
operator corrects them.

_Source:_ #303

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-tenant-keeps-its-billing-details.test.js`
    - the tenant changes how it is reached
        - the ${field} can be changed but not cleared, and a refused change writes nothing
        - the ${field} reaches the service through the pipe and is refused there, not dropped

<!-- END proof -->

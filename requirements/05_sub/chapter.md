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
    - a window opened by a change
        - makes the day it opens on the day the customer is billed on
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

- `packages/adapter-drizzle/tests/integration/an-operator-runs-the-plan-catalogue.integration.test.js`
    - a tenant's own writes
        - a change that leaves the plan as it is › keeps the bound version, and the offer of the
          newer one, when it moves only the rhythm
        - a change that leaves the plan as it is › a sale binds the version in effect, and no longer
          offers it as pending
        - a change that leaves the plan as it is › a change to another plan is scheduled with the
          version it was quoted at, and bound to it
- `packages/adapter-prisma/tests/prisma-tenant-subscription-write.test.js`
    - PrismaTenantSubscriptionWriteAdapter
        - a change that leaves the plan as it is › keeps the bound version, and the offer of the
          newer one, when it moves only the rhythm
        - a change that leaves the plan as it is › a sale binds the version in effect, and no longer
          offers it as pending
        - a change that leaves the plan as it is › binds the version in effect where the
          subscription is bound to none
        - a change that leaves the plan as it is › a rebinding between its read and its write is not
          written over
- `packages/nest/tests/every-way-a-tenant-meets-the-end.test.js`
    - a plan version published before the customer left
        - does not roll onto a subscription whose term is over
        - while a cancellation still to come stops nothing
        - and an uncancelled subscription rolls as before
- `packages/nest/tests/pending-plan-materialization.test.js`
    - a scheduled change keeps the version the subscriber is bound to where it leaves the plan as it
      is
- `packages/nest/tests/plan-change-preview.test.js`
    - a subscriber on an older version of the plan
        - is quoted the version they keep for a change of rhythm, and loses nothing by it
        - sees the price they pay as their current one when changing plan
        - is refused a rhythm the version they keep is not sold in, rather than quoted it free
        - is quoted from the catalogue where no repository reads versions
        - is quoted a change at a version the change can name › another plan at the version live
          now, priced from that version and named by it
        - is quoted a change at a version the change can name › the plan it stays on at the version
          kept
        - is quoted a change at a version the change can name › none where nothing reads versions,
          priced from the catalogue
        - is shown the price they pay › at the version they keep, in either rhythm, not the
          catalogue's
        - is shown the price they pay › as none in a rhythm the version they keep is not sold in,
          not as 0
        - is shown the price they pay › as none where the version they keep is sold under a special
          contract
        - is shown the price they pay › as unknown, not the catalogue's, where the version bound
          cannot be read
        - is shown the price they pay › as unknown where the version bound is a version of another
          plan
        - is shown the price they pay › and a change is refused with a code rather than quoted from
          the catalogue
        - is shown the price they pay › from the catalogue where no repository reads versions, or
          none is bound
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
    - a scheduled change keeps the version the subscriber is bound to where it leaves the plan as it
      is
    - a scheduled change to another plan binds the version it was quoted at
    - a scheduled switch to a newer version of the same plan binds that version
    - the run reads and writes every tenant's change inside the bypass

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

### SC-SUB-019 — A subscriber is shown the price of the version they are bound to

🟢 💰 The account read (`GET billing/usage`, as `planPriceNet`) and the plan card state what the
subscription pays per billing cycle at the version it is bound to, priced by the rules its contract
is frozen by — not the price the catalogue lists for new customers. After a new version of the plan
those are two numbers, and the card is where a subscriber checks the one on the next invoice. Where
no repository reads plan versions, the catalogue is the only reading there is and its price is
shown.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/plan-change-preview.test.js`
    - a subscriber on an older version of the plan
        - is shown the price they pay › at the version they keep, in either rhythm, not the
          catalogue's
        - is shown the price they pay › as none in a rhythm the version they keep is not sold in,
          not as 0
        - is shown the price they pay › as none where the version they keep is sold under a special
          contract
        - is shown the price they pay › as unknown, not the catalogue's, where the version bound
          cannot be read
        - is shown the price they pay › as unknown where the version bound is a version of another
          plan
        - is shown the price they pay › and a change is refused with a code rather than quoted from
          the catalogue
        - is shown the price they pay › from the catalogue where no repository reads versions, or
          none is bound
- `packages/nest/tests/tenant-billing-controller.test.js`
    - getUsage states the price the subscription pays, as the plan preview reads it off the version
      bound
- `packages/ui-vue-tenant/tests/component/a-subscriber-sees-the-price-they-pay.test.ts`
    - the plan card
        - shows the price of the version the subscription is bound to, not the catalogue's
        - shows no price where the version bound has none in this rhythm, whatever the catalogue
          lists

<!-- END proof -->

### SC-SUB-020 — A newer version is offered, classified against the version bound

🟢 💰 A subscriber whose plan has a newer version than the one they are bound to can read it as an
offer: both versions side by side — features, quotas and the price in each rhythm — with the kind of
offer and when a switch taken now would take effect. The kind is decided by a rule against the
version bound, not against the candidate's predecessor and not by a flag set at publish: a feature
missing or a quota lower takes something away, whatever the price, and a switch would take effect at
the end of the running term; otherwise a price higher in any rhythm is more for more, taking effect
at once; otherwise it is an improvement, taking effect at once. The version offered is the one a
booking made now would bind, by its validity window, and only when it is newer than the version
bound; it is offered only where the subscription could take it — not ended, not on a plan kept for a
special contract, sold in its rhythm, and with no change of plan or rhythm and no pending version still
to land, since the offer is judged against what the subscriber will have. Every user of the tenant
can read the offer.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/active-plan-version-query.test.js`
    - isVersionActiveAt — the same window, for a row already read
        - validFrom is inclusive to the millisecond
        - validUntil is inclusive of its whole day
        - endsAt is exclusive: a version ended at the moment takes nothing
        - an absent date does not close the window, and dates may come as strings
        - agrees with the WHERE clause on every combination around the boundaries
- `packages/core/tests/version-offer.test.js`
    - the worked examples of the operator's decision
        - 49 €, 5 users, 150 vehicles is an improvement
        - 59 €, 8 users, 200 vehicles is more for more
        - 45 €, 3 users, 200 vehicles takes something away, although it is cheaper
        - the same monthly price but a dearer yearly one is more for more
        - one feature less takes something away, everything else equal
    - prices
        - equal in both rhythms, written differently, is no change
        - lower in one rhythm and equal in the other is an improvement
        - a cent more in one rhythm is more for more
        - a rhythm the candidate no longer sells counts against it
        - a rhythm the candidate sells and the bound version did not is an improvement
        - dearer and a feature less takes something away: what is missing decides
    - quotas
        - equal is no change
        - one more is an improvement
        - one less takes something away
        - unlimited instead of a number is an improvement
        - a number instead of unlimited takes something away
        - a quota the candidate no longer carries takes something away
    - features
        - the same set in another order is no change
        - one more is an improvement
        - one swapped for another takes something away
    - an offer states every difference, bound to candidate
- `packages/nest/tests/a-newer-version-is-offered.test.js`
    - an offer
        - shows both versions side by side, prices as numbers per rhythm
        - that improves takes effect at once
        - that costs more for more takes effect at once
        - that takes something away takes effect at the end of the running term
        - that takes something away waits for a minimum term that outlasts the period
        - that takes something away from a trial waits for its end
        - is made to a subscription whose cancellation has not landed yet
    - the version offered is the one a booking made now would bind
        - by its validity window, not the newest published
        - and nothing where the window finds nothing on sale
        - and nothing where the subscription is bound to a newer one than that
    - no offer
        - while the subscription is on the newest version
        - where the newer version changes nothing compared
        - for a version that does not take bookings yet
        - for a version that has ended
        - for a version not sold in the subscription's rhythm
        - for a version not marketed
        - while a change to another plan is scheduled
        - while a change of rhythm is scheduled
        - while a pending version has yet to land
        - once the cancellation has landed
        - on a plan kept for a special contract, either way round
        - where the version bound cannot be read as a version of the plan
        - where the newest version read is of another plan
        - without a repository that reads versions
        - where the subscription is bound to no version
    - a tenant without a subscription is told so
    - GET billing/version-offer
        - reads the offer of the caller's own tenant, whatever the request names
        - refuses a request that carries no tenant
        - is open to every user of the tenant, not only its administrator
- `packages/ui-vue/tests/use-tenant-billing-url.test.js`
    - the version offer is read under the same prefix and answered as the offer itself
- `packages/ui-vue-tenant/tests/component/a-newer-version-is-offered-beside-the-plan.test.ts`
    - the offer beside the plan
        - is not there where nothing is offered
        - shows both versions side by side, with what is added and when a switch takes effect
        - says a rhythm the new version is not sold in, and an unlimited quota
        - says what one that takes something away removes, and the date it would take effect
        - is not shown on a subscription that has ended

<!-- END proof -->

### SC-SUB-021 — A newer version is taken by naming it, the way its kind says

🟢 💰 The tenant's administrator takes the offered version by naming it. An improvement and more for
more take effect at once, on the plan and in the rhythm the subscription has, with the term and the
period kept, and cost what any contract taking effect inside a paid period costs: the difference for
the rest of the period where the price in the subscriber's own rhythm is higher, nothing where it is
not. One that takes something away takes effect at the end of the running term, bound to the version
offered; it is refused like a downgrade while today's usage exceeds a quota it lowers, and refused
where the subscription ends, or the version stops being sold, before it would take effect. A version
ended after it was taken keeps the subscription on the version it has. The switch goes ahead only
while the version named is still the one offered — otherwise nothing changes and the offer as it now
stands comes back. Where contracts are frozen, a successor contract records the switch when it takes
effect, and the audit trail records who took it.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-version-offer-is-taken.test.js`
    - an improvement and more for more are taken at once
        - an improvement binds the version offered on the plan and in the rhythm the subscription
          has
        - more for more is taken the same way
        - the term and the period are kept: no window is opened and the status stays
        - the successor contract is frozen from now and the account brought up to date
        - a subscription cancelled for later is switched, and its contract still ends then
        - in a trial nothing is frozen and nothing charged
    - one that takes something away is taken at the end of the term
        - scheduled for the term end and bound to the version offered
        - usage up to the lower quota fits
        - usage one above the lower quota is refused like a downgrade, with the numbers
        - a quota the version offered no longer carries allows nothing
        - an unlimited quota holds any usage
        - refused while the cancellation lands at the term end, since it would never happen
        - refused where the version offered stops being sold at the term end
        - taken where it is ended a moment after the term end
        - refused where its window closes the day before the term end, taken where it closes that
          day
        - taken where the cancellation lands after the term end
    - the switch goes ahead only while the version shown is still the offer
        - another version named is refused, carrying the offer as it stands
        - no offer at all is refused the same way, carrying none
        - a subscription that moved before an immediate switch was written is told to reload
        - a version no longer offered when the write came is answered with the offer as it stands
        - and so is one that moved before a switch at the term end was recorded
        - a tenant with no subscription is told so
        - a tenant the contract freeze cannot name is refused before anything moves
    - POST billing/version-offer/accept
        - names the version shown, and nothing else is needed
        - a missing, empty or non-text version is refused
        - asks for the tenant administrator
        - switches the caller's own tenant and records who did it
- `packages/nest/tests/pending-plan-materialization.test.js`
    - a scheduled switch to a newer version of the same plan binds that version
- `packages/ui-vue/tests/use-tenant-billing-url.test.js`
    - an offer is taken by posting the version shown, and the usage reloaded after
- `packages/ui-vue-tenant/tests/component/a-newer-version-is-offered-beside-the-plan.test.ts`
    - taking it
        - an improvement is taken by one click, and the page says so
        - more for more asks first, and closing the question takes nothing
        - one that takes something away asks first with the date, and is recorded for the term end
        - an offer that moved is replaced by the one that stands, and the refusal is in the app
          language
        - a refusal with no offer to show still says why

<!-- END proof -->

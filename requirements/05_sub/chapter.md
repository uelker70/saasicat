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
    - computeNextPeriod
        - null when currentPeriodEnd null (Trial)

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

🟢 Nor complete onboarding or book an add-on.

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

🔵 _(Superseded on 2026-10-01 by `SC-SUB-024`.)_ It is offered as a pending change instead. A change
that only improves things takes effect at the next renewal; one that takes something away only takes
effect if the tenant accepted it, and is otherwise dropped when its date arrives.

_Source:_ release 1.0.0-rc.6 · `docs/explanation/data-model.md`

### SC-SUB-013 — Nothing rolls forward onto a subscription whose cancellation has landed

🔴 _(Withdrawn on 2026-10-01.)_ A version becomes due because a date arrived, not because anybody
still wants it.

_Source:_ release 1.0.0-rc.6

### SC-SUB-014 — Accepting the same pending version twice changes nothing

🔴 _(Withdrawn on 2026-10-01.)_ And accepting one when none is pending is refused rather than silently
accepted.

_Source:_ `docs/reference/error-codes.md`

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
special contract, sold in its rhythm, and with no change of plan or rhythm still to land, since the
offer is judged against what the subscriber will have. Every user of the tenant can read the offer.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/active-plan-version-query.test.js`
    - isVersionActiveAt — the same window, for a row already read
        - validFrom is inclusive to the millisecond
        - validUntil is inclusive of its whole day
        - endsAt is exclusive: a version ended at the moment takes nothing
        - a superseded version takes bookings only within a last day it carries
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
        - once the cancellation has landed
        - on a plan kept for a special contract, either way round
        - where the version bound cannot be read as a version of the plan
        - where the version on sale read is of another plan
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
        - says so where the offer could not be read, rather than showing nothing
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
        - after a refusal the page shows the subscription as it now stands, not as it was read
        - a refusal with no offer to show still says why

<!-- END proof -->

### SC-SUB-022 — A subscriber is told once of each newer version offered to them, when it is offered

🟢 Where the application turns version notices on, the administrators of a tenant hear of a newer
version of their plan once, through the application's own messages: when the offer appears beside
the plan (`SC-SUB-020`) — not when the version is published — so a version whose window opens later
is told when it opens, and a subscription with a change still to land is told once it has landed.
The notice carries what the offer shows: both versions side by side, the kind of offer and when a
switch would take effect. Each newer version is told once per subscription; nothing is repeated,
there is no reminder and nothing to decline. A notice the application could not send is tried
again by the next run, and one sent to nobody is kept as such rather than tried again; the platform
runs every quarter of an hour, unless the application runs it from a scheduler of its own. The two
cases a subscriber can hear twice: the process stops after the application sent the notice and
before it was recorded as sent, or the application takes longer than a quarter of an hour to answer
and another run takes the notice on meanwhile.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-subscriber-is-told-once.test.js`
    - a newer version offered to a subscriber
        - is told with the offer, and the record keeps to whom and how
        - is not told again by the next run
        - is told of each newer version it is offered, once each
        - whose window has not opened is told once it opens, not when it is published
        - is not told while a change is still to land, and is told once it has
        - is asked for only among subscriptions on older versions, so one already on it hears
          nothing
        - is told to every subscription it is offered to, each with its own tenant
    - a notice the application could not send
        - is tried again by the next run, and then kept as sent
        - that the application throws on before it answers fails like any other, and the run goes on
        - told to nobody is kept as sent to no one, and not tried again
        - sent but not recorded counts as sent, and is not sent again while its claim holds
        - is claimed at the moment it is taken, not when the run began
        - that the application answers only after the timeout stays held, and a late success is kept
          as sent
        - that fails only after the timeout is let go for the next run
        - held by another run is left to it
    - a run reads and writes across tenants inside the RLS bypass
    - turning version notices on
        - is refused over a usage port that cannot list subscriptions across tenants
        - is refused over a plan repository that cannot read a version
        - starts over ports that have both
    - the run every quarter of an hour
        - waits while the application is locked for maintenance
        - lets a run pass while the one before it is still sending

<!-- END proof -->

### SC-SUB-023 — Every notice to a subscriber is recorded: once, with when and to whom it went

🟢 🔒 Each notice is kept as a record of its own — the subscription, what it was about, what it said,
when it went out, to whom and through which channel — and there is one record per subscription and
subject however many instances send notices at the same time. The record outlives the
subscription, as the subscriber's account does.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/subscription-notice-mapping.test.js`
    - a notice read back
        - not yet delivered carries no delivery
        - delivered carries to whom and how, and nobody where nobody was told
        - of every kind the platform sends is read back as that kind
        - of a kind the platform does not know is refused, naming the row
        - delivered without a readable delivery is refused, naming the row
- `packages/nest/tests/a-subscriber-is-told-once.test.js`
    - a newer version offered to a subscriber
        - is told with the offer, and the record keeps to whom and how
    - a notice the application could not send
        - told to nobody is kept as sent to no one, and not tried again
        - sent but not recorded counts as sent, and is not sent again while its claim holds
        - is claimed at the moment it is taken, not when the run began
        - that the application answers only after the timeout stays held, and a late success is kept
          as sent
        - held by another run is left to it

<!-- END proof -->

### SC-SUB-024 — A subscription keeps its plan version until the subscriber takes another

🟢 💰 Features, quotas and price stay those of the version the subscription is bound to — during the
term and across every renewal. A newer version is offered beside the plan (`SC-SUB-020`) and binds
only when the subscriber takes it (`SC-SUB-021`); no renewal, no change of rhythm and no job of the
platform moves a subscription to another version on its own, neither better nor worse. A change to
another plan binds that plan's version, the one its preview quoted.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/adapter-drizzle/tests/integration/an-operator-runs-the-plan-catalogue.integration.test.js`
    - a tenant's own writes
        - a change that leaves the plan as it is › keeps the bound version when it moves only the
          rhythm
        - a change that leaves the plan as it is › a sale binds the version in effect
        - a change that leaves the plan as it is › a change to another plan is scheduled with the
          version it was quoted at, and bound to it
- `packages/adapter-prisma/tests/prisma-tenant-subscription-write.test.js`
    - PrismaTenantSubscriptionWriteAdapter
        - a change that leaves the plan as it is › keeps the bound version when it moves only the
          rhythm
        - a change that leaves the plan as it is › a sale binds the version in effect
        - a change that leaves the plan as it is › binds the version in effect where the
          subscription is bound to none
        - a change that leaves the plan as it is › a rebinding between its read and its write is not
          written over
- `packages/nest/tests/pending-plan-materialization.test.js`
    - a scheduled change keeps the version the subscriber is bound to where it leaves the plan as it
      is
- `packages/nest/tests/plan-change-preview.test.js`
    - a subscriber on an older version of the plan
        - is quoted the version they keep for a change of rhythm, and loses nothing by it
        - sees the price they pay as their current one when changing plan
        - is refused a rhythm the version they keep is not sold in, rather than quoted it free
        - is quoted from the catalogue where no repository reads versions
        - is quoted a change at a version the change can name › another plan at the version on sale
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

### SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it

🟢 💰 Retiring a version announces to the subscriptions on it that they continue on a replacement the
operator names: a version on sale, of the same plan or of another, so a whole plan can be phased
out. The version retired has to be off sale, so nobody books it after the announcement; a price
increase therefore lets the new version start first and retires the old one after. It needs
`tenantBilling.orderlyRetirement.termsConfirmed` in `config/saas.yaml`, the operator's statement
that their terms carry the clause a retirement rests on: without it the administration does not
offer the action and the server refuses it with a code, and with it but nowhere to keep an
announcement the application does not start. A retirement that would reach nobody is refused too,
and so is one whose replacement has no price in the rhythm a subscription it reaches is billed in.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-is-offered-where-it-is-wired.test.js`
    - retiring a version is offered
        - where announcements are kept and the terms are confirmed: routes and capability
        - while the terms are not confirmed: the routes, but no capability
        - not without ${without}: neither the routes nor the capability
        - not without the catalogue's operator routes, terms confirmed or not
    - terms confirmed to allow a retirement
        - with nowhere to keep one, the installation does not start, naming the setting
        - with a place to keep it, it starts
        - unconfirmed, it starts without one too
- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - the preview of a retirement
        - may name a version of another plan as the replacement
        - reports what would refuse the announcement, all of it at once › a version still on sale,
          on its last day too
        - reports what would refuse the announcement, all of it at once › but not one whose last day
          was yesterday
        - reports what would refuse the announcement, all of it at once › a version only scheduled
          for sale is not off sale either
        - reports what would refuse the announcement, all of it at once › a replacement that is not
          on sale: a draft, or one whose sale has ended
        - reports what would refuse the announcement, all of it at once › a replacement with no
          price in the rhythm a subscription is billed in
        - reports what would refuse the announcement, all of it at once › a replacement with no
          price in the rhythm a subscription will be billed in by then
        - reports what would refuse the announcement, all of it at once › but not one whose
          subscriptions are all billed in a rhythm it is sold in
        - reports what would refuse the announcement, all of it at once › nobody on the version to
          tell
        - reports what would refuse the announcement, all of it at once › several at once
        - is refused where the terms are not confirmed, before anything is read
    - announcing a retirement
        - refuses what the preview reports, with every blocker, and writes nothing
        - refuses where the terms are not confirmed, and writes nothing
- `packages/ui-vue/tests/an-operator-retires-a-version.test.js`
    - where retiring is offered
        - on a version no longer on sale, and on no other
- `packages/ui-vue/tests/component/an-operator-retires-a-version-in-the-cockpit.test.ts`
    - retiring a version in the plan cockpit
        - is offered on the version no longer on sale, and on no other

<!-- END proof -->

### SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown

🟢 💰 Before announcing, the operator sees every running subscription on the version with the date
it would continue on the replacement, and every subscription it would not reach with the reason:
ended, cancelled for a date by then, moving to another plan or version by then, or told already by
an earlier announcement of this version, which stands — a subscription hears of a version's
retirement once. The announcement names the subscriptions shown. Where they are no longer the ones
it reaches, it is refused with the preview as it stands, rather than told to somebody the operator
has not looked at.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-takes-effect-at-a-term-end.test.js`
    - a subscription with a change of rhythm scheduled
        - counts its terms in the new rhythm from the day it lands, never inside the yearly term
        - keeps the old rhythm where the change lands after the effective date
        - is billed in the new rhythm where the change lands on the effective date
- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - the preview of a retirement
        - shows each running subscription on the version with its effective date
        - lists the subscriptions it does not reach, with the reason
    - announcing a retirement
        - accepts the subscriptions shown in any order
        - refuses when the subscriptions shown are ${name}, and writes nothing
        - a second announcement of the version leaves the subscriptions it told alone
        - one told of it more than a year ago is still left alone
- `packages/ui-vue/tests/an-operator-retires-a-version.test.js`
    - the retirement flow
        - announces behind the second factor, naming the replacement and whom it was shown
        - a preview that changed meanwhile replaces the one shown, and says so
- `packages/ui-vue/tests/component/an-operator-retires-a-version-in-the-cockpit.test.ts`
    - retiring a version in the plan cockpit
        - shows the replacement, its price, the dates and whom it misses before anything is sent

<!-- END proof -->

### SC-SUB-027 — A retirement's date is the end of a term at least three calendar months away

🔵 _(Superseded on 2026-10-02 by `SC-SUB-035`.)_ For each subscription, the first end of one of its
terms that lies at least three calendar months after the announcement — never inside a term the
customer has paid for. Terms are counted in the subscription's own rhythm from the end of the
period running now; a subscription in its trial counts them from the end of the trial, and one with
a change of rhythm scheduled counts them in the new rhythm from the day it lands. The last day to
cancel without notice is the last whole UTC day before the date, since a term ends at the moment it
was booked.

_Source:_ #357

### SC-SUB-028 — A subscription is reached by a retirement at most once in twelve months

🟢 💰 A retirement that would reach a subscription told of another within the last twelve months is
refused, saying how many of its subscriptions that holds for.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - a subscription is reached at most once in twelve months
        - one reached eleven months ago holds the announcement back, counted
        - one reached exactly twelve months ago still does
        - one reached a moment longer ago does not
        - a notice of another kind does not count

<!-- END proof -->

### SC-SUB-029 — Every subscription a retirement reaches is told, and what it was told is kept

🟢 💰 The announcement and one notice per subscription are written together, so there is no
announcement whose notices are missing, and then handed to the application's own messages: both
versions side by side with their prices, the date the subscription continues on the replacement,
and the last day it may cancel without notice. A notice the application could not send is sent by
the next run, which the platform runs every quarter of an hour. What is recorded is the notice as it
was told (`SC-SUB-023`).

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - announcing a retirement
        - keeps the announcement, records a notice per subscription and tells each
        - writes the announcement and its notices in one transaction
        - a notice that cannot be taken on is left for the next run, and the others are told
        - a notice whose sending and letting go both fail is counted as failed, not thrown
        - an audit entry that cannot be written does not make the announcement read as failed
        - a notice the application cannot send now stays recorded and goes out with the next run
    - the run that sends what an announcement could not
        - sends only retirement notices, and leaves one another run holds
        - a notice sent late names the date counted from its sending, and the day before it
        - a notice sent after the ones before it counts from its own sending, not from the start of
          the run
        - a notice answered too late with nobody to tell is tried again, not recorded as told
        - a notice sent a minute late keeps the date it was announced with
        - a notice the application tells nobody of is tried again until somebody is told
        - says once a day, not on every run, that a notice still reaches nobody
        - tells nobody who has left the version, and still tells the others
        - tells nobody whom the retirement no longer reaches, and still tells the others
        - runs inside the bypass
    - the run every quarter of an hour
        - sends what an announcement could not after the offers, reading the clock as it starts
        - sends neither while the application is locked for maintenance

<!-- END proof -->

### SC-SUB-030 — A tenant sees the retirement of its version beside its plan

🟢 The plan section says when the subscription continues on which version of which plan, what that
version costs beside the one it is on, and until when it may be cancelled without notice — and says
the last of these again in the confirmation of a cancellation. What it says is the notice the
subscriber was told.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue-tenant/tests/component/a-retired-version-is-announced-beside-the-plan.test.ts`
    - a retired version, beside the plan
        - says when the subscription moves on, to which version, and what it costs then
        - is not shown where nothing is being retired
        - is said again in the confirmation of a cancellation

<!-- END proof -->

### SC-SUB-031 — A subscription continues on the replacement at the date it was told

🟢 💰 At the date each subscription was told, the platform moves it from the retired version onto
the replacement, at the replacement's price in the subscription's rhythm, keeping its period and its
term. A run every quarter of an hour finds the subscriptions whose date has come and that are still
on the retired version, so a run that did not happen — under a maintenance lock, on a stopped server
— is caught up by the next. It leaves alone a subscription that has ended by its date and one whose
own scheduled change takes it off the version by then; a change the subscriber scheduled for later
survives the move, and one that only moves the rhythm follows the subscription to the replacement's
plan. A move and the contract it writes are one: where the contract cannot be written, the move is
put back — onto the retired version whether or not it is still on sale, since undoing a move books
nothing — so no subscription runs on the replacement under the retired version's contract, unless
putting it back fails as well. Each move is written to the audit log as the platform's job. A move
that cannot be made — no party for the contract, a replacement that no longer takes bookings, a
contract that cannot be written — is recorded there once, tried again by every run, and the charge
journal waits for it (`SC-PRIC-062`); one that could not be put back either is recorded as such and
not tried again, since the subscription is no longer on the retired version.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-is-offered-where-it-is-wired.test.js`
    - where retiring is wired, it also takes effect
        - the run that moves subscriptions at their date, and the switch, are there
- `packages/nest/tests/a-retirement-takes-effect.test.js`
    - the move at the date
        - moves a subscription still on the version retired, keeping its term and what it scheduled
        - records the move under the platform job, naming both versions
        - moves nothing before the date, and catches up a run that did not happen
        - leaves a subscription that has ended by its date, and moves one that ends after it
        - leaves a subscription whose own change takes it off the version by its date
        - moves a trial without a contract or a charge: both come when it converts
        - a subscription that changed between the read and the write is left to the next run
        - a replacement the write refuses is a failure, recorded once however often it is tried
        - moves nothing whose notice has reached nobody, however late it is
        - a tenant without a subscriber to name is not moved at all
        - a move whose contract cannot be written is put back, and the next run makes both, where
          the version retired ${offSale}
        - a move put back takes the change of rhythm it scheduled back to the plan it left
        - a put-back that fails outright is recorded as one refused, and the run goes on
        - a move that cannot be put back either says so in the audit log
        - a change of rhythm scheduled between the read and the write is left to the next run
        - a subscription already on the replacement is left alone
        - runs across tenants: the write is made inside the bypass
        - the quarter-hour run moves what is due after the notices, and pauses under maintenance

<!-- END proof -->

### SC-SUB-032 — A subscriber may switch to the replacement early, at no more than they paid

🟢 💰 Until the date, a subscription on a version being retired may move to the named replacement at
once, from the plan section. The switch keeps the period and the term. Where the replacement costs
more in the subscription's rhythm, the subscriber goes on paying what they paid until the date they
were told (`SC-PRIC-063`); where it costs the same or less, its price applies from the next period.
The switch opens after a trial, and not while a change is scheduled, the subscription has ended, or
either plan is held for a special contract — the rule a version offer follows. The confirmation says
what the switch costs until the date and after it, and that cancelling without notice is no longer
available once switched: that right rests on the version being retired (`SC-CANC-023`). A page that
named another version than the replacement is refused with the retirement as it stands, and a switch
whose contract cannot be written is put back — whether or not the retired version is still on sale —
and refused, so nothing has changed unless putting it back fails as well, which the server log
names.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-lets-a-subscriber-leave-without-notice.test.js`
    - the switch to the replacement, as the tenant asks for it
        - the usage says what it costs where it is open, and nothing where no retirement is pending
        - switches to the version the page named, for the tenant asking
        - is refused where retiring versions is off
- `packages/nest/tests/a-retirement-takes-effect.test.js`
    - the free switch before the date
        - moves at once, keeps the term, and holds the price until the date where the replacement
          costs more
        - holds the difference of the subscriber’s own rhythm
        - holds nothing where the replacement costs the same or less
        - is refused where no retirement waits for its date
        - is refused, with the retirement as it stands, where the page named another version
        - opens only after the trial
        - is refused while something is outstanding, as a version offer is
        - is refused while an add-on running today cannot run on the replacement’s plan
        - goes through with the add-ons the replacement’s plan can carry
        - is refused where the subscription changed between the read and the write
        - whose contract cannot be written is put back and refused, and nothing is charged, where
          the version retired ${offSale}
        - that is put back keeps a change scheduled while its contract was being written
        - that cannot be put back either says so in the log, naming the subscription
        - is refused before anything moves where the contract could not name its party
        - is offered with its terms where it is open, and not otherwise
- `packages/ui-vue/tests/use-tenant-billing-url.test.js`
    - switchToReplacement posts the version shown to /billing/retirement/switch, then reloads
- `packages/ui-vue-tenant/tests/component/a-retired-version-is-announced-beside-the-plan.test.ts`
    - the switch to the replacement, before the date
        - is offered where the subscription may take it, and not otherwise
        - says what it costs until the date and after it, and that cancelling without notice lapses
        - says a price that is not higher applies from the next period
        - switches to the version shown when confirmed, and says so

<!-- END proof -->

### SC-SUB-033 — The operator sees how far each retirement has come

🟢 Beside each retired version, the administration counts the subscriptions the retirement reached:
moved — at their date, by a switch, or by a change of their own — waiting for their date, ended by
it, and overdue: past their date and still on the version, a move the platform could not make yet.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-takes-effect.test.js`
    - how far a retirement has come
        - counts the subscriptions it reached as moved, waiting, overdue or ended
        - counts a subscription whose notice has reached nobody as not told, not as overdue
- `packages/ui-vue/tests/an-operator-retires-a-version.test.js`
    - how a preview reads
        - how far a retirement has come says the states with subscriptions in them, overdue first
- `packages/ui-vue/tests/component/an-operator-retires-a-version-in-the-cockpit.test.ts`
    - retiring a version in the plan cockpit
        - says how far the retirement has come, and marks a move overdue

<!-- END proof -->

### SC-SUB-034 — Where staying put costs something, a subscription is reminded once

🟢 💰 A subscription told of a retirement is reminded once, 14 days before the date it was told,
where staying put costs it something: the replacement is dearer in the rhythm it is billed in at that
date — or not sold in it — or takes a feature away or lowers a quota. A price that rises only in
another rhythm costs it nothing, and it is not reminded. The reminder goes through the same notice
port as the announcement, says again what the subscription was told and what a switch taken now
would cost, and is recorded with whom it went to and how. A run that did not happen on the day is
caught up by the next, until the date. It is not sent where the subscription has cancelled, has
ended, has switched, or leaves the version by the date through a change of its own. Beside each
retired version, the administration counts the subscriptions reminded.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/core/tests/a-retirement-reminds-where-staying-costs.test.js`
    - whether staying put costs a subscription something
        - ${what}
    - when the reminder is due
        - 14 days before the date, at its time of day
        - from that moment until the date, and not a millisecond either side
- `packages/nest/tests/a-retirement-is-offered-where-it-is-wired.test.js`
    - where retiring is wired, it also takes effect
        - the run that reminds subscriptions before their date is there
- `packages/nest/tests/a-retirement-reminds-once.test.js`
    - the one reminder of a retirement
        - reminds 14 days before the date, as it was told, with what a switch now would cost
        - reminds nothing before its day, and catches up a run that did not happen until the date
        - reminds once, however often the run comes
        - reminds where staying costs something in the rhythm billed at the date, and only there
        - reminds where a feature is taken away, whatever the price
        - leaves alone a subscription that cancelled, ended, switched or leaves the version by its
          date
        - reminds nobody whose notice has reached nobody: there is no date to remind of
        - reminds a trial, which cannot switch before it ends
        - a reminder the application could not send is sent by the next run
        - a reminder that cannot be put together fails for that subscription alone
        - runs across tenants: the reminder is sent inside the bypass
        - the quarter-hour run reminds after the notices and before the moves, and pauses under
          maintenance
        - a step of the quarter-hour run that fails holds up none of the others
        - the operator sees how many were reminded: reminders that reached somebody
- `packages/ui-vue/tests/an-operator-retires-a-version.test.js`
    - how a preview reads
        - how far a retirement has come says how many were reminded, last and beside the states
- `packages/ui-vue/tests/component/an-operator-retires-a-version-in-the-cockpit.test.ts`
    - retiring a version in the plan cockpit
        - counts the subscriptions reminded beside the states, unmarked

<!-- END proof -->

### SC-SUB-035 — A retirement's date is a term end at least three months after its notice arrived

🟢 💰 For each subscription, the first end of one of its terms that lies at least three calendar
months after its notice of the retirement reached an administrator of the tenant — never inside a
term the customer has paid for. A notice the announcement sends at once counts from the
announcement; one that could not be sent then counts from the moment it is, and names the date
counted from then. Terms are counted in the subscription's own rhythm from the end of the period
running now; a subscription in its trial counts them from the end of the trial, and one with a
change of rhythm scheduled counts them in the new rhythm from the day it lands. The last day to
cancel without notice is the last whole UTC day before the date, since a term ends at the moment it
was booked.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retirement-takes-effect-at-a-term-end.test.js`
    - the effective date of a retirement
        - monthly, periods starting on the 1st: the first period end from 15 June on — 1 July
        - a term that ends at the time of day it was booked leaves the whole day before as the last
        - yearly, the term ending on 31 December: 1 January
        - yearly, the term ending on 31 March, less than three months away: a year later
        - a term ending exactly three months after the announcement is the effective date
        - and one a millisecond earlier is not
        - periods anchored on the 31st land on the last day of a shorter month
        - a subscription without a period end counts its terms from its start
    - a subscription in its trial
        - counts its terms from the end of the trial
        - takes effect at the end of the trial where that is far enough away
    - a subscription with a change of rhythm scheduled
        - counts its terms in the new rhythm from the day it lands, never inside the yearly term
        - keeps the old rhythm where the change lands after the effective date
        - is billed in the new rhythm where the change lands on the effective date
    - three calendar months
        - keep the day of the month and the time of day
        - end on the last day of a month that has no such day
        - cross into the next year
- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - the run that sends what an announcement could not
        - a notice sent late names the date counted from its sending, and the day before it
        - a notice sent after the ones before it counts from its own sending, not from the start of
          the run
        - a notice sent a minute late keeps the date it was announced with

<!-- END proof -->

### SC-SUB-036 — A retirement waits for its notice to reach the subscriber

🟢 💰 Until its notice has reached at least one administrator of the tenant, a retirement changes
nothing for the subscription: no move, no reminder, no switch offered and nothing shown beside its
plan, and its periods are charged from the version it is on. A notice the application could not
send, or sent to nobody, is tried again by every run until somebody is told; one whose subscription
has left the version, or that the retirement no longer reaches, is not sent. A replacement cannot be
terminated while a notice onto it has not reached its subscriber. Beside each retired version, the
administration counts the subscriptions not told yet.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-retired-version-is-charged-to-its-date.test.js`
    - a retirement whose notice has reached nobody
        - charges nothing differently: the version the subscription is on prices its periods
- `packages/nest/tests/a-retirement-reminds-once.test.js`
    - the one reminder of a retirement
        - reminds nobody whose notice has reached nobody: there is no date to remind of
- `packages/nest/tests/a-retirement-takes-effect.test.js`
    - the move at the date
        - moves nothing whose notice has reached nobody, however late it is
    - ending a version subscriptions still move onto
        - is refused while a notice onto it has reached nobody, whatever end is asked for
    - how far a retirement has come
        - counts a subscription whose notice has reached nobody as not told, not as overdue
- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - the run that sends what an announcement could not
        - a notice answered too late with nobody to tell is tried again, not recorded as told
        - a notice the application tells nobody of is tried again until somebody is told
        - says once a day, not on every run, that a notice still reaches nobody
        - tells nobody who has left the version, and still tells the others
        - tells nobody whom the retirement no longer reaches, and still tells the others
    - the retirement that reaches a subscription
        - is none while its notice has reached nobody, and the notice once it has
    - the retirements a subscription was told of
        - are none while the notice has reached nobody
- `packages/ui-vue/tests/an-operator-retires-a-version.test.js`
    - how a preview reads
        - how far a retirement has come puts the subscriptions not told after the overdue ones,
          asking for a look
- `packages/ui-vue/tests/component/an-operator-retires-a-version-in-the-cockpit.test.ts`
    - retiring a version in the plan cockpit
        - marks the subscriptions not told yet for a look

<!-- END proof -->

### SC-SUB-037 — A retirement cannot move a subscription onto a plan its add-ons cannot run on

🟢 💰 The announcement is refused while a subscription it reaches still holds, at its date, an
add-on that cannot run beside the replacement, on its plan and in the rhythm billed then. The
preview counts those subscriptions, so the operator can name a replacement that fits.

_Source:_ #357

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/an-operator-announces-a-retirement.test.js`
    - the preview of a retirement
        - a replacement on another plan, and the add-ons the subscriptions hold › is refused where
          an add-on still booked at the date cannot run on its plan
        - a replacement on another plan, and the add-ons the subscriptions hold › and the
          announcement refuses it as well
        - a replacement on another plan, and the add-ons the subscriptions hold › takes no notice of
          an add-on the plan can carry
        - a replacement on another plan, and the add-ons the subscriptions hold › nor of a booking
          that has ended on the date itself
        - a replacement on another plan, and the add-ons the subscriptions hold › but of one that
          ends a day after it
        - a replacement on another plan, and the add-ons the subscriptions hold › a replacement on
          the same plan carries what that plan carries
        - a replacement on another plan, and the add-ons the subscriptions hold › asks in the rhythm
          billed at the date, where a switch of rhythm lands before it

<!-- END proof -->

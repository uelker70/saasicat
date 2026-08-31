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

### SC-SUB-002 — The minimum term is the billing period that was chosen, and it starts at activation

🟢 Monthly or yearly. There is no third rhythm, and no commitment separate from the period unless an
operator configures one for an add-on.

_Source:_ #212

### SC-SUB-003 — A term renews by itself unless it was cancelled first

🟢 The commitment renews with the period, because the commitment is the period.

_Source:_ #212

### SC-SUB-004 — A short month does not move the billing day

🟢 A subscription billed on the 31st is billed on 28 February and then on 31 March. One billed on the
30th is billed on the 30th of October, not the 31st: the day is "the 30th", not "the end of the
month". Reading the next date off the previous one let a single February move a tenant's billing
day permanently three days earlier, and every date derived from it moved too — the renewal, the
notice deadline, and the end date the customer was told about.

_Source:_ #220 · `docs/guides/upgrade-to-1.0.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - comes back to the 31st after February
    - and without an anchor it never comes back — the case this exists for
    - is billed on the 30th in a 31-day month
    - and on the 28th in February, then back to the 30th
    - is billed on the 28th in ordinary years and the 29th when one comes round
    - keeps the anchor across every step it takes
    - and reaches the anchor day itself where the month is long enough
    - and an explicit anchor overrides the start it was given
    - rolls back onto the day the customer is billed on
    - and without a stored anchor keeps the day it landed on
    - is billed on that day in every month, long or short
    - and the first of the month is not confused with the last of the one before
    - stays on the 31st, because the month is the same one every year
    - and the day the customer is billed on moves with it
    - ${impossible} is treated as absent, not as a day
    - while a possible one is used
    - buys the period the customer is billed for, to its day
    - and without a stored anchor keeps the old, shorter answer
    - while an on-time cancellation does not reach the step at all
    - is treated as absent for the whole walk, not for each step

<!-- END proof -->

### SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal

🟢 Reading its own previous result is precisely the drift it exists to stop.

_Source:_ #220

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-billing-day-survives-a-short-month.test.js`
    - comes back to the 31st after February
    - and without an anchor it never comes back — the case this exists for
    - is billed on the 30th in a 31-day month
    - and on the 28th in February, then back to the 30th
    - is billed on the 28th in ordinary years and the 29th when one comes round
    - keeps the anchor across every step it takes
    - and reaches the anchor day itself where the month is long enough
    - and an explicit anchor overrides the start it was given
    - rolls back onto the day the customer is billed on
    - and without a stored anchor keeps the day it landed on
    - is billed on that day in every month, long or short
    - and the first of the month is not confused with the last of the one before
    - stays on the 31st, because the month is the same one every year
    - and the day the customer is billed on moves with it
    - ${impossible} is treated as absent, not as a day
    - while a possible one is used
    - buys the period the customer is billed for, to its day
    - and without a stored anchor keeps the old, shorter answer
    - while an on-time cancellation does not reach the step at all
    - is treated as absent for the whole walk, not for each step

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
    - periodEndWithMinLead MONTHLY with <42d lead — skips period
    - periodEndWithMinLead — minLeadDays configurable (14d, accepts exactly 14d)
    - periodEndWithMinLead — minLeadDays 15d on same date jumps to next period

<!-- END proof -->

### SC-SUB-007 — A subscription with no period does not renew

🟢 A trial, or a subscription still waiting on a negotiated contract, has nothing to roll forward.

_Source:_ release 1.0.0-rc.6

### SC-SUB-008 — A declared cancellation does not stop the renewal until it lands

🟢 Where a notice period pushed the ending into the following period, that period has to exist before
it can end.

_Source:_ release 1.0.0-rc.6

### SC-SUB-009 — A tenant in arrears can still cancel

🟢 A tenant whose payment failed wanting out is the single most important cancellation there is, and
a status check placed one line too early would refuse it.

_Source:_ #218

### SC-SUB-010 — A subscription that has ended can no longer change plan

🟢 Nor complete onboarding, accept a pending version, or book an add-on.

_Source:_ `docs/reference/error-codes.md`

### SC-SUB-011 — A subscription with nothing left to run is recorded as ended

🟢 Rather than left looking active for good, because nothing downstream would ever have moved it.

_Source:_ release 1.0.0-rc.6

### SC-SUB-012 — A new version of a plan does not move a customer who already bought one

🟢 It is offered as a pending change instead. A change that only improves things takes effect at the
next renewal; one that takes something away only takes effect if the tenant accepted it, and is
otherwise dropped when its date arrives.

_Source:_ release 1.0.0-rc.6 · `docs/explanation/data-model.md`

### SC-SUB-013 — Nothing rolls forward onto a subscription whose cancellation has landed

🟢 A version becomes due because a date arrived, not because anybody still wants it.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/a-cancellation-is-a-boundary.test.js`
    - refuses a plan change instead of charging for one
    - while a running one still changes plans
    - lets the plan change, and does not sell a term it cuts short
    - while an uncancelled subscription does get a fresh term
    - the preview says so before the reader has decided anything
    - and an ended subscription is refused outright, not merely locked
    - and says nothing when the cycle stays
    - is refused, because the ending was calculated in the old rhythm
    - while the plan still moves on the cycle it was sold in
    - and an uncancelled subscription may change cycle freely
    - the immediate change is refused rather than written over it
    - and so is the scheduled one
    - while an unchanged subscription is written as decided
    - is refused rather than written a moment late
    - the second one reports the first one rather than replacing it
    - is declined once the cancellation has taken effect
    - but a cancellation still to come declines nothing
    - and an uncancelled subscription is applied as before

<!-- END proof -->

### SC-SUB-014 — Accepting the same pending version twice changes nothing

🟢 And accepting one when none is pending is refused rather than silently accepted.

_Source:_ `docs/reference/error-codes.md`

### SC-SUB-015 — A scheduled change that comes due after the customer has left is declined and recorded

🟢 A change that never happened is something an operator may be asked about later.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/nest/tests/pending-plan-materialization.test.js`
    - materializes all due pending plan changes and invalidates each tenant
    - defaults to MONTHLY cycle when pendingBillingCycle is null
    - is non-fatal per tenant — one failure does not abort the run
    - no-op when nothing is due

<!-- END proof -->

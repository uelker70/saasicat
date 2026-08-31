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

### SC-SUB-005 — The billing day is fixed when a period opens and is never rewritten by a renewal

🟢 Reading its own previous result is precisely the drift it exists to stop.

_Source:_ #220

### SC-SUB-006 — Billing dates do not move when the clock does

🟢 Period boundaries are computed so that a daylight-saving change cannot shift a billing date by a
day.

_Source:_ release 1.0.0-rc.7

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

### SC-SUB-014 — Accepting the same pending version twice changes nothing

🟢 And accepting one when none is pending is refused rather than silently accepted.

_Source:_ `docs/reference/error-codes.md`

### SC-SUB-015 — A scheduled change that comes due after the customer has left is declined and recorded

🟢 A change that never happened is something an operator may be asked about later.

_Source:_ release 1.0.0-rc.6

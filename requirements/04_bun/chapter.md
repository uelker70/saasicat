---
title: Add-on bundles
---

An add-on is bought on top of a plan and lives and dies with it. Nearly everything here follows
from that one sentence: the rhythm it may be billed in, when its periods end, what happens when
the plan ends, and why no money ever comes back. The chapter also says what a tenant has to be
told before they buy, because several of these rules are only fair if they are read first.

### SC-BUN-001 — An add-on is bought on top of a plan, never instead of one

A tenant cannot use an add-on without a plan, so the plan is what an add-on hangs off.

_Source:_ #222

### SC-BUN-002 — An add-on's periods end on the day the plan's do

The alignment is made when the add-on is booked rather than repaired when the plan ends, because a
period that has to be trimmed is one somebody was committed to more of than they received — and
then owed the difference.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-003 — The first period of a booking is short, and charged for exactly that stretch

It runs from the booking to the next occurrence of the plan's billing day and is charged pro rata.
The fraction is taken against a whole cycle of the add-on's own rhythm, so a monthly add-on on a
yearly plan is not charged a fraction of a year at a monthly price.

_Source:_ #222

### SC-BUN-004 — A tenant on a monthly plan cannot book a yearly add-on

The plan would end twelve times before the add-on's first period did, and each of those is a
moment the tenant could be left committed to something that grants nothing.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-005 — A tenant on a yearly plan chooses the rhythm each add-on is billed in

Preselected to the plan's own rhythm, so a tenant who does nothing gets what they would have got
before. On a monthly plan no control appears: a question with one answer is not a question.

_Source:_ #234

### SC-BUN-006 — The price an add-on is advertised at is the price it is booked at

Including its unit. A card saying "per month" beside a yearly plan is the figure a tenant compares
add-ons by, and comparing by the wrong one is a decision made on wrong information even when the
confirmation later shows the right amount.

_Source:_ #234

### SC-BUN-007 — An add-on with no price in the chosen rhythm is shown as unavailable

Rather than as a button the server will refuse.

_Source:_ #234

### SC-BUN-008 — An add-on carries no commitment unless an operator configures one

The default is none. A twelve-month commitment nobody asked for is a different product, and it
made "cancellable to the next period end" impossible for eleven of those months.

_Source:_ #239

### SC-BUN-009 — An add-on can be cancelled at any time and ends with the period it is in

Up to the moment its next period begins. The premise behind it is that no money is ever paid back:
the tenant pays for the period they are in, it ends normally, and no refund arises.

_Source:_ #239 · #212

### SC-BUN-010 — The period an add-on ends at is its own, not the plan's

For a monthly add-on beside a yearly plan those are up to eleven months apart, and reading the
plan's boundary kept a cancelled booking committed and billed until the annual renewal.

_Source:_ #222 · release 1.0.0-rc.7

### SC-BUN-011 — An add-on has no notice period

Cancelling one takes effect at the end of its own period, or at the end of its commitment where
that runs longer, or at the plan's end where that comes first — whenever it is declared, including
on the last day. An add-on hangs off the plan that pays for it, its commitment is the minimum
term, and a second waiting period on top is one nobody could explain to a customer.

_Source:_ #230 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-012 — An add-on can never be committed past the subscription that pays for it

Its commitment is capped at the plan's end, read afresh when the cancellation is worked out — a
cap applied at booking cannot see a cancellation that had not happened yet.

_Source:_ #221 · #222

### SC-BUN-013 — A commitment of none stays none

Capping an uncommitted booking at the plan's end would invent a commitment: the booking could then
not be cancelled until the plan ended, which is the opposite of what "no commitment" is for.

_Source:_ #222

### SC-BUN-014 — A tenant who has already cancelled may still book an add-on for the time left

The commitment is shortened rather than the purchase refused. An add-on is priced per period
rather than per commitment, so a shorter one cannot overcharge them.

_Source:_ #221 · release 1.0.0-rc.6

### SC-BUN-015 — Ending with the plan is not a cancellation

No notice is given and none is needed, and the period the add-on is in when the plan ends is not
refunded. The alignment exists so that day is a period boundary in the first place.

_Source:_ #222

### SC-BUN-016 — A tenant reads what a booking commits to before confirming it

When the first period ends, when the plan it hangs on ends, and plainly that a shortened booking
is not refunded. The no-refund rule is fair only if it is read before the decision rather than
discovered after it, and it is stated as a plain sentence rather than a warning, because it holds
for every booking and a warning that always fires teaches people to skip warnings.

_Source:_ #222

### SC-BUN-017 — An add-on without a price cannot be published

For every plan the add-on is offered to, a price has to resolve in that plan's rhythm — from the
add-on's own price or from an override set for that plan. A published add-on with no price was
bookable and handed over its features for nothing, and nobody downstream could tell that from a
deliberately free one. Catching it at publication puts the mistake at the operator's desk rather
than at a tenant's checkout.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-018 — A yearly price is never derived from a monthly one

Multiplying by twelve invents a price nobody set. If a yearly price were always twelve monthly
ones, there would be no reason to have two figures.

_Source:_ #222

### SC-BUN-019 — What an add-on costs depends on the plan beside it and the rhythm it is billed in

Not on the add-on alone. An operator may price the same add-on differently for one plan, or give
it its only price there.

_Source:_ #234

### SC-BUN-020 — An add-on whose contents a tenant already has raises a warning, not a refusal

Whether the overlap comes from the plan or from another booking, the tenant is told they would pay
twice. Where a selection is fully covered by what is already chosen, it is dropped from the price
and from the booking rather than sold.

_Source:_ #212

### SC-BUN-021 — An add-on whose own dependencies nothing covers cannot be booked

If it needs a feature that neither the plan nor another active booking supplies, it would not
work.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-022 — An add-on cannot be booked on a subscription that has already ended

It would be charged, listed and inert. Reading and cancelling stay open, so somebody whose
subscription has ended can still see what they booked and explain their invoices; what closes is
the till.

_Source:_ #218 · release 1.0.0-rc.6

### SC-BUN-023 — Only a published, current version of an add-on can be booked

A draft, a superseded version and one whose validity has not started are not on offer.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-024 — An add-on version somebody has already booked cannot be edited

Same reason as for a plan version: what was sold does not change underneath the customer.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-025 — An add-on may be restricted to particular plans

Where no restriction is stated, every plan may book it.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-026 — An add-on that is not sold self-service says so and says who to ask

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-027 — The same add-on cannot be booked twice on one subscription

Not while the first booking is still running.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-028 — A cancelled booking can be reinstated only before its cancellation takes effect

Afterwards it is booked again rather than revived.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-029 — A move to a shorter plan rhythm is refused while a longer add-on is running

The tenant cancels the add-on first, and the change then goes through. It is refused rather than
converted or ended: ending it early owes the customer the difference, and converting it invents a
price nobody agreed to. The refusal is judged as of the day the change would land, so following
the advice actually works.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-030 — An add-on price of exactly zero has to be meant

A deliberately free add-on leaves its price unset. An explicit zero is refused unless the operator
says it is intended, for the same reason it is on a plan.

_Source:_ `docs/reference/error-codes.md`

### SC-BUN-031 — An add-on booked against a plan that has no period yet gets no invented one

During a trial, or while an enterprise deal is still with sales, there is nothing to align to. The
booking is left without a period and without a commitment rather than being given a made-up one,
and it joins the plan's rhythm once the plan has a paid period. Both ends of a period are written
together or neither: a half-stated period is a state no reader can interpret.

_Source:_ #222 · `docs/guides/upgrade-to-1.0.md`

### SC-BUN-032 — An add-on's key never changes

Renaming one means creating a new add-on and retiring the old one, because customers are bound to
the old key.

_Source:_ `docs/explanation/data-model.md`

### SC-BUN-033 — An add-on bought after a contract was agreed takes effect immediately

It used to grant nothing until something re-froze the contract, and where the optional hook was
not configured that never happened — silently.

_Source:_ release 0.14.0

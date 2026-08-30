---
title: Trials, pilots and negotiated arrangements
---

Not every subscription is an ordinary paid one. A trial commits to nothing, a pilot is a granted
arrangement, and an enterprise deal may sit with sales for weeks. Each of them answers the
questions in the previous chapters differently, and this chapter says how — because the failure
mode is a rule written for the ordinary case being applied to one of these.

### SC-SPEC-001 — A trial commits to nothing, so a plan change during one takes effect at once

Deferring an upgrade to the end of a trial withholds the very thing the customer asked to try.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-002 — Cancelling during a trial ends the trial, and no sooner

It lands when the trial does. Ending it on the spot would take the trial away as the price of
saying they do not want to convert; treating it as a term meant a customer cancelling a
yearly-cycle trial bought a year.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-003 — A notice period never applies to a trial

The window exists so a term cannot be left at the last moment, and a trial has no term to leave.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-004 — Switching plans during a trial carries the remaining trial time over

The time already used is deducted rather than restarted, and repeated switches do not accumulate
or lose days. Where the plan being moved to has no trial, the trial end stays where it was.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-005 — A trial grants the trial's entitlements, not the booked plan's

And it opens no billing period; the agreement is frozen when the subscription becomes a paid one.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-006 — A pilot arrangement outranks every other way of resolving what a tenant may do

Ahead of trial, ahead of a pending negotiation, ahead of a scheduled change.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-007 — Granting, withdrawing or extending a pilot is a deliberate operator act

It needs a second factor and an explicit confirmation, and it is recorded.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-008 — A negotiated arrangement is expressed as limits set for that tenant

Limits set for the tenant replace the plan's; features set for the tenant are added to the plan's.
The two behave differently on purpose: a negotiated limit is a substitution, a negotiated feature
is an addition.

_Source:_ release 1.0.0-rc.6

### SC-SPEC-009 — A subscription waiting on a negotiated contract falls back to a named interim plan

It has no billing period, and cancelling it takes effect immediately, because there is nothing
running to see out.

_Source:_ release 1.0.0-rc.6

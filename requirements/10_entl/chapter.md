---
title: What a tenant may do at runtime
---

Everything above decides what was sold. This chapter is about the moment it is applied: a request
arrives, and the answer has to be the one the contract gives. These are the requirements an
integrating developer relies on most directly, because a mistake in them is either a customer
paying for something they cannot use or using something they did not pay for.

### SC-ENTL-001 — What a tenant may do is their plan plus the add-ons they booked

🟢 Features are the union; limits add up.

_Source:_ `docs/explanation/concepts.md`

### SC-ENTL-002 — An unlimited allowance beats any number, and an absent one counts as none

🟢 So a single unlimited grant cannot be diluted by adding numbers to it, and a limit nobody set is
not silently generous.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-003 — A feature declared as not yet rolled out is never granted

🟢 Wherever it comes from — a plan, an add-on, or a negotiated arrangement. It can be advertised in
the catalogue and still not be handed over.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-004 — Once a contract is agreed, it is the truth about what the tenant may do

🟢 Catalogue edits do not reach a running contract.

_Source:_ `docs/explanation/capability-to-contract.md` · `README.md`

### SC-ENTL-005 — A request for something the contract does not include is refused

🟢 And the refusal may carry what would unlock it, so the tenant is told how to proceed rather than
only that they may not. Where several features would each admit the request, having any one of
them is enough.

_Source:_ `README.md` · `docs/reference/error-codes.md`

### SC-ENTL-006 — A missing feature and an exhausted limit are told apart

🟢 They are two different answers, and a client can act differently on each. An exhausted limit says
which limit and where the tenant stands against it.

_Source:_ `docs/reference/error-codes.md`

### SC-ENTL-007 — Two simultaneous requests cannot both take the last remaining unit of a limit

🟢 Counting and then writing happens as one indivisible step per tenant; otherwise two requests that
each fit both go through and the limit an operator sold is not the limit that applies.

_Source:_ `docs/explanation/data-model.md` · `docs/reference/options.md`

### SC-ENTL-008 — A single large action can be refused by a limit it would cross in one go

🟢 The check is against what the action would consume, not against a single unit, so one ten-gigabyte
file does not fit under a one-gigabyte allowance.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-009 — The declarative check is a guard, not a guarantee

🟢 Applied to a route it is deliberately a soft check and can be raced. Where a limit must hold
exactly, the transactional path is the one to use, and the difference is stated rather than
implied.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-010 — A limit nothing can count does not block anybody

🟢 The request goes through and the gap is reported for review, rather than a tenant being refused
because an installation has not finished wiring a counter.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-011 — Enforcing a limit nobody declared is the installation's fault, not the tenant's

🟢 It is answered as a misconfiguration rather than as a refusal the tenant could do something about.

_Source:_ `docs/reference/error-codes.md`

### SC-ENTL-012 — A cancellation that has taken effect grants nothing

🟢 No features, no limits. Until this rule existed, a subscription cancelled eight months earlier was
granted exactly what it was granted while active.

_Source:_ #219 · `docs/guides/upgrade-to-1.0.md`

### SC-ENTL-013 — A cancellation that is merely declared changes nothing

🟢 A subscription cancelled in month three of a year runs, is billed and keeps everything until the
term ends.

_Source:_ #219

### SC-ENTL-014 — An installation may name a floor a cancelled subscription falls back to

🟢 A read-only tier a former customer can export from, or a free plan, instead of nothing. Add-on
bookings and negotiated limits are not carried into it, because those belonged to the subscription
that ended.

_Source:_ #219 · `docs/guides/upgrade-to-1.0.md`

### SC-ENTL-015 — The end of a subscription is seen on every enforcement path

🟢 A rule written into one of two paths is enforced in half the applications, and two paths that
disagree about what a cancelled subscription keeps would be worse than either answer alone.

_Source:_ #219

### SC-ENTL-016 — An answer computed before an end date arrives is not served after it

🟢 A date arriving is not a change anybody makes, so nothing would invalidate a remembered answer by
itself.

_Source:_ #219

### SC-ENTL-017 — A feature that was renamed keeps working for customers who bought the old name

🟢 An existing contract holding a superseded key grants its successors, and keeps the old one too, so
a rename in the catalogue is never a silent downgrade for somebody already paying.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-018 — An offer shown alongside a refusal is one the tenant could actually buy

🟢 Only currently marketed, live add-ons are offered, ranked by how much of what is missing they
cover and then by price. A failure to work out an offer never turns a correct refusal into a
server error.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-019 — A platform administrator is not blocked by a tenant's entitlements

🟢 Support can act on a tenant's behalf without the tenant having bought the feature being used.

_Source:_ release 1.0.0-rc.6

### SC-ENTL-020 — Hiding a control is not protection

🟢 The interface hides what the backend would refuse; the refusal is what protects it. A tenant who
constructs the request by hand gets the same answer.

_Source:_ `docs/guides/build-the-admin-frontend.md`

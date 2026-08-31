---
title: Repeating an operation safely
---

Deployments fail and get retried; containers restart; a pipeline step is run again. This chapter
is written from the operator's side and says what they can repeat without holding their breath.
The requirement behind all of it: SaaSiCat keeps no ledger of which migrations have run, so every
one of them has to be safe to run twice.

### SC-OPS-001 — An operator can retry a failed deployment

🟢 Every shipped migration applied a second time either does nothing, or refuses with a sentence
saying why. Never an unexplained database error, and never a second application of the same
effect. This exists because it happened: a migration dropped a column, the next container start
asked that column for its values, and the message named the column rather than the retry.

_Source:_ `CONTRIBUTING.md`

### SC-OPS-002 — A migration is safe on a partially adopted schema

🟢 An installation that never took a particular table migrates the ones it does have, instead of
rolling the whole thing back.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-003 — An operator can list what a migration will touch before running it

🟢 Every migration that changes rows ships with the query that shows which ones.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-004 — A destructive step is preceded by a check, not by turning the safety off

🟢 Adding a flag that lets a tool discard data would arm every future change to do the same without
being asked.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-005 — A tool that cannot finish stops before it changes anything

🟢 Where the advice it prints is only followable while the change is unapplied, it does not apply
half of it first.

_Source:_ release 0.27.0

### SC-OPS-006 — Applying the same external event twice changes nothing

🟢 Payment providers retry, and a retry must not produce a second account or a second charge.

_Source:_ `docs/explanation/data-model.md`

### SC-OPS-007 — Repeating an action a person took changes nothing either

🟢 Cancelling twice, accepting the same pending version twice, ending an already-ended contract —
each reports the state that already holds instead of creating a second effect.

_Source:_ release 1.0.0-rc.6

### SC-OPS-008 — A scheduled job that has not run for months catches up in one step

🟢 Not one step per missed period, and not by walking forward one period at a time until it arrives
at today.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-009 — Periods advance when the operator's own job runs them, never behind their back

🟢 SaaSiCat decides what the next period should be; writing it is the integrator's scheduled job. An
installation that never runs it loses nothing it had — the next period is simply never opened.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-OPS-010 — An installation starts, or refuses; it does not start half-configured

🟢

_Source:_ `docs/reference/options.md`

### SC-OPS-011 — Dates are handled with their time zone stated, not inferred

🟢 Server time, browser time and the tenant's own time are three different things, and a billing date
is one of the places where confusing them costs money.

_Source:_ internal engineering guidelines

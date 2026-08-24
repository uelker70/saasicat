# ADR 0008 — Pages take resources, not callbacks

**Status:** accepted · **Date:** 2026-08-15

## Context

The admin pages were configured through props. `TenantsPage` took 23 of them,
15 of which were functions: `loadTenants`, `onSuspend`, `onReactivate`,
`formatKpi`, and so on. Mounting one standard page in a consumer app cost
between 8 and 145 lines of glue, with no rule saying which — the notesapp admin
carried 716 lines of it and one consumer 1,409.

Worse than the volume: a function prop is an unbounded contract. Every page
invented its own argument shapes, and an app that wanted to change one operation
had to supply all of them.

## Decision

A page in `src/pages/` takes at most five props — `resources`, `params`,
`options` and their kin — and **no function props at all**.

Data access is a **resource descriptor**: one object per family
(`tenants`, `plans`, `promoCodes`, …) defining each operation as a request
against the injected `HttpClient`. Pages read resources from a registry provided
by the shell. An application that needs different behaviour overrides one
operation of one resource — one line — and the platform keeps serving the other
nine.

## Alternatives considered

- **Fewer, better props.** The number was never the problem. A callback prop is
  a contract the page cannot check and the platform cannot extend.
- **A store per page.** Moves the wiring into a second place without removing
  it, and makes the page's data source invisible from the page.
- **Slots for everything.** Good for presentation, useless for behaviour: a slot
  cannot answer "what happens when this row is suspended".

## Consequences

- The glue disappears rather than moving. Ten of the thirteen standard pages are
  routes with static props in the consumers; the remaining wrappers exist for
  genuinely app-owned data.
- An operation the platform does not serve can still be a descriptor — the
  paths every consumer already calls (`/users/:id/reset-password` and its kin)
  are recorded so pages need no callback for them, with
  `app-served-resources.test.js` pinning the request each one issues.
- Overriding is composition, not replacement: an override of `dashboard.kpi`
  leaves the rest of the dashboard resource untouched.

## What breaks if you ignore this

Adding a function prop to a page reintroduces the idiom in one file, and the
next page copies it — that is exactly how the count reached 64.

`packages/ui-vue/tests/pages-take-no-callbacks.test.js` resolves every prop type
through the compiler, so `onSave?: SaveHandler` behind an alias falls as well as
an inline signature. A page that genuinely needs one declares it at the prop
with `@pageContractException` and a reason — the exception travels with the
code, not in a list inside the test.

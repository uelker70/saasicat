---
title: Capabilities, features and quotas
---

Before anything can be sold, somebody has to say what the application can do. This chapter covers
the path from a declaration in code to an entry an operator may put in a plan. The point of it is
that there is only ever one list: the code is the source, and the catalogue is a reviewed
projection of it rather than a second thing to keep in step.

### SC-CAT-001 — What the application can do is declared next to the code that does it

There is no separate spreadsheet or hard-coded feature list to keep in step with the
implementation.

_Source:_ `docs/explanation/capability-to-contract.md`

### SC-CAT-002 — Nothing a developer declares is sold automatically

New and changed declarations are presented for review. A product owner accepts them into the
catalogue; until then they are visible and not sellable. Discovery is a controlled way to let code
reality into the product, not an automatic one.

_Source:_ `docs/explanation/capability-to-contract.md`

### SC-CAT-003 — Only approved features and quotas may be put in a plan or a bundle

A key that code declares but nobody has reviewed cannot be sold, and publishing a version that
names one is refused.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-004 — A plan may not reference something no code implements

A feature no code declares and a limit nothing counts cannot be sold. Code is the source of truth
for what exists.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-005 — A marketed non-code feature is the one narrow exception, and is configured explicitly

Something like a support commitment can be sold without any code implementing it. A feature that
is merely not built yet does not belong there.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-006 — Approval needs a scan to compare against

An installation that has not yet read its own declarations cannot accept entries into the
catalogue, and says so rather than accepting them blind.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-007 — A catalogue entry moves along a fixed path

Discovered, accepted, active, deprecated, retired — or set aside as ignored. A step outside that
order is refused, so the state of an entry always says the same thing to everyone reading it.

_Source:_ `docs/explanation/concepts.md`

### SC-CAT-008 — An approved entry whose code definition changes goes back for review

It flips to outdated by itself rather than continuing to claim an approval that was given for
something else.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-009 — Bringing a retired entry back is always a person's decision

The automatic scan at start-up never reactivates one.

_Source:_ `docs/explanation/concepts.md`

### SC-CAT-010 — Labels an operator has written are never overwritten by the scan

The automatic sync fills empty fields and leaves curated ones alone.

_Source:_ `docs/explanation/concepts.md`

### SC-CAT-011 — Four words with four meanings, kept apart

A capability is implemented, a feature is marketable, a quota is countable, and a plan or bundle
is sellable. The distinction is what lets an operator repackage the product without a developer,
and a developer refactor the code without repricing anything.

_Source:_ `docs/explanation/concepts.md`

### SC-CAT-012 — A new declaration appears for review after the application restarts

The scan happens when the application starts. An operator who cannot see a colleague's new
capability is waiting for a deployment, not looking in the wrong place.

_Source:_ `docs/guides/wire-the-backend.md`

### SC-CAT-013 — A quota key is named in exactly one place

The declaration in code. It cannot be introduced in a configuration file, and it cannot contain a
separator that would make it ambiguous where a plan lists it.

_Source:_ release 0.2.0

### SC-CAT-014 — An unsatisfied dependency between features is advice, not a refusal

A feature that requires another one may have that other one covered by the plan, by a different
bundle, or by something the operator sells separately, and none of that is visible while a draft
is being checked. A bundle naming a plan that does not exist is refused outright, because that one
is decidable.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-015 — A missing scan degrades the check, it does not stop the application

Where the strictest setting is configured but nothing can be compared against, the installation
warns loudly and keeps running. Crashing there once caused a production outage.

_Source:_ `docs/reference/error-codes.md`

### SC-CAT-016 — The check that runs before a deployment always blocks

There is no advisory mode in the pre-deployment gate: a violation stops the deployment. The same
check runs before the first write of seeded data.

_Source:_ `docs/reference/error-codes.md`

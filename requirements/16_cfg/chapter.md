---
title: Configuring and running an installation
---

Where a setting lives, what happens when it is missing, and what an operator can see about the
configuration that is actually running. The organising idea is that a setting has exactly one
home: a value that can come from two places is a value nobody can be sure of.

### SC-CFG-001 — A setting lives in exactly one place

Not in a file with a fallback in code, and not in a database with a file that seeds it. Both of
those are a single source of truth with a footnote.

_Source:_ #217

### SC-CFG-002 — Settings with a money or a legal consequence live in the configuration file

Where a change goes through review and a deployment. For a value changed twice a year the
deployment is not friction — it is the review, and version control answers "who changed the notice
period, when, and why" better than an audit table does. Delivered for the notice period and the
self-service plan blocks; the settings still passed in code move in later steps.

_Source:_ #217

### SC-CFG-016 — A setting that moved out of code is removed, not deprecated

An installation that still passes it in code does not start, and is told which file it belongs in.
Accepting it as a fallback would leave two homes, and ignoring it silently is worse still: the
value an operator set is the one they believe is running, so the application would not fail — it
would work, differently, until a customer's cancellation landed a period late.

_Source:_ #217

### SC-CFG-017 — A required setting is required member by member, not as a block

A block naming only one of two rhythms is refused rather than read as zero for the other. The rule
that a silent default is an invisible decision does not stop at the outermost level of the
document.

_Source:_ #217

### SC-CFG-018 — An empty list and a zero are values an operator wrote, not omissions

"No plan is blocked from self-service" and "there is no notice period" are commercial statements,
and the file says them out loud rather than by leaving a line out.

_Source:_ #217

### SC-CFG-019 — A migration tool reports a setting that moved; it does not delete it

The value is a term somebody agreed. Removing it from the code without writing it into the file
would leave the installation running on whatever the file happens to say — the failure the move
exists to prevent, committed by the tool meant to perform it. What makes reporting safe rather
than lax is [SC-CFG-016](#sc-cfg-016--a-setting-that-moved-out-of-code-is-removed-not-deprecated):
the boot refusal means the report cannot be acted on halfway.

_Source:_ #217

### SC-CFG-003 — A setting that must change without a deployment is kept out of the file entirely

And lives in one audited place instead of two. Adding a second home is what this rule exists to
prevent.

_Source:_ #217

### SC-CFG-004 — Payment credentials are never in a committed file and never in a table

They come from the environment.

_Source:_ #217

### SC-CFG-005 — A missing required setting stops the installation, naming the file and the field

A silent default is also a decision, just an invisible one.

_Source:_ #217 · `docs/reference/options.md`

### SC-CFG-006 — A misconfigured installation is told everything that is wrong at once

Each problem named and linked to what it means. Fixing them is one restart, not one per line.

_Source:_ `docs/reference/options.md`

### SC-CFG-007 — A capability that is turned off says so, once, at start-up

A capability that vanishes without a word is indistinguishable from a bug in the integrator's own
code.

_Source:_ ADR 0007

### SC-CFG-008 — An operator can see when the running configuration was applied, and from where

Somebody who edited the file an hour ago otherwise has no way to tell whether it has landed. The
timestamp is the requirement, not decoration. 🟡 _(Decided, not yet delivered.)_

_Source:_ #217

### SC-CFG-009 — A configuration change is noticed and reported

The record inside the application is unconditional; notifying people by mail is an addition, never
a substitute. An address list that silently swallowed the notification because nobody wired mail
would be worse than having neither. 🟡 _(Decided, not yet delivered.)_

_Source:_ #217

### SC-CFG-010 — An installation that declares a protection and enforces nothing does not start

Where routes are annotated as requiring a feature and nothing is checking it, the installation
refuses to boot and names the routes. Otherwise the routes answer, the limits read as unlimited,
and the first signal is a customer using something they never bought. A protection the integrator
wrote themselves counts, once they say it is one — recognition is by declaration, not by the class
being named the same as ours.

_Source:_ `docs/guides/upgrade-to-1.0.md` · release 0.27.0

### SC-CFG-011 — An application that declares nothing to enforce still starts

A catalogue with no runtime enforcement is a real shape, not a mistake.

_Source:_ release 0.27.0

### SC-CFG-012 — Conflicting routes stop the boot

Rather than one quietly shadowing the other and an operator discovering it from a support ticket.

_Source:_ `docs/guides/integrate-into-an-existing-app.md`

### SC-CFG-013 — A generated application does not compile until the integrator names their access rules

An empty list is this platform's word for "deliberately open", so scaffolding one would have left
the discovery and manifest endpoints answering to anybody.

_Source:_ release 0.27.0

### SC-CFG-014 — An installation whose own tables are named differently keeps its administration

The mapping is configuration, not a reason to turn the administration off wholesale.

_Source:_ release 0.27.0

### SC-CFG-015 — Set-up commands print what they wrote, with the values and the path

So the first thing a new integrator learns is where their settings live, rather than discovering
it when one is wrong.

_Source:_ #217

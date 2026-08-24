# ADR 0001 — PolyForm Shield instead of Apache-2.0

**Status:** accepted · **Date:** 2026-08-20

## Context

SaaSiCat was published under Apache-2.0 from the start. Apache-2.0 is permissive:
anyone may take the code, rebrand it, and sell it as their own product with no
obligation beyond attribution.

That is the outcome this project does not want. SaaSiCat is the foundation under
applications the author sells — the value is in the platform being theirs, not in
the platform being widely redistributed. The realistic risk is not that someone
resells a NestJS library, which is a market nobody makes money in; it is that
someone takes the foundation and rebuilds one of the applications standing on it.

At the time of this decision the project has no external users: one month old,
zero stars, zero forks, and download counts consistent with CI and registry
mirrors rather than adoption. Relicensing is therefore cheap. It stops being
cheap once a community exists — the well-known cases (Elasticsearch, Terraform)
each produced a fork and lasting friction, because a community had built on a
promise that was then withdrawn.

## Decision

Adopt **PolyForm Shield 1.0.0**, unmodified, for all packages.

Everything is permitted except providing a product that competes with SaaSiCat or
with a product the author provides using it. Reading it, running it, changing it,
redistributing it, and building and selling a SaaS on top of it are all
permitted. There is no time limit and no reversion.

## Alternatives considered

- **Stay on Apache-2.0.** Maximum adoption, no protection. Rejected: adoption is
  not the goal that pays, and the protection is the point.
- **AGPL-3.0.** Stays OSI open source and deters commercial use through the
  network-copyleft obligation — but does not forbid a competing product, only
  makes it expensive. Rejected as indirect: it addresses the objective through a
  side effect rather than by saying it.
- **FSL-1.1-Apache-2.0 / BUSL-1.1.** Same restriction, but every version reverts
  to a permissive license after two or four years. Rejected: a competitor only
  has to wait. That trade is reasonable for a fast-moving hosted product where a
  two-year-old snapshot is worthless; it is not reasonable for a framework whose
  architecture is the durable part.
- **Elastic License 2.0.** Also unlimited in time, but drawn around _hosting_ the
  software as a service. Rejected because the shape does not fit: SaaSiCat is a
  library that runs inside the consumer's application, so "offering it as a
  managed service" is not the scenario to guard against.

## Consequences

- **The project is source-available, not open source.** PolyForm Shield is not
  OSI-approved. Documentation that calls SaaSiCat open source is now false and
  has been corrected; new text must not reintroduce the claim.
- **Published versions keep their license.** Everything up to and including
  0.26.1 was released under Apache-2.0 and stays there. npm versions are
  immutable, and the rights granted with them cannot be withdrawn. The
  restriction applies from the first release carrying the new license.
- **Adoption will be lower.** Some organisations block non-OSI dependencies
  outright, and some developers avoid them for infrastructure. This is the price
  of the decision, accepted knowingly.
- **"Competes" is deliberately broad.** PolyForm leaves the term open, which is
  what makes it effective and also what makes corporate counsel cautious. No
  attempt is made here to narrow it; that would need a modified license, and a
  modified license is a new license nobody has reviewed.
- **Dependencies stay permissive.** Every runtime dependency is MIT today. A
  copyleft dependency would conflict with distributing under these terms, so a
  new dependency's licence is now part of the decision to add it.
- **Contributions.** The project has a single author, so this change needed no
  one else's consent. Should outside contributions arrive, accepting them without
  a contributor agreement would fragment the copyright and make any future
  relicensing impossible.

This is a licensing decision recorded by an engineer, not legal advice. The
wording of PolyForm Shield — in particular what "competes" covers in a dispute —
is worth a review by someone qualified to give it.

## What breaks if you ignore this

Calling the project open source — in a README, a changeset, a talk — is a
factual error about a license that is not OSI-approved, and it is the kind of
error people repeat. `tests/license-is-consistent.test.js` holds the license
fields and headers; the wording is on the author.

Adding a copyleft dependency is the expensive version. Its terms would conflict
with distributing this under PolyForm Shield, and the conflict is only
discoverable by reading the dependency's license — so a new dependency's license
is part of the decision to add it. Where it is unclear, flag it rather than
add it.

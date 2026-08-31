---
title: Compatibility and upgrading
---

What an integrating developer may expect when they raise a version. The whole chapter is one
promise with several consequences: a break is deliberate, announced, and accompanied by whatever
can be automated — and where it cannot be automated, it is named rather than guessed at.

### SC-COMP-001 — All packages carry one version number and move together

🟢 There is no compatibility matrix to reason about; a mixed set is a misconfiguration.

_Source:_ `CONTRIBUTING.md` · `README.md`

### SC-COMP-002 — A break is deliberate, documented, and belongs to a release that says it is breaking

🟢 It is never something a consumer discovers from a failing build after a patch release.

_Source:_ `CONTRIBUTING.md`

### SC-COMP-003 — There is one deliberate break on the way to 1.0, and one guide for it

🟢 A single coordinated cut with a migration guide and a command that performs most of it, rather
than a long tail of deprecations.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-COMP-004 — The upgrade command reports what it cannot decide rather than guessing

🟢 A tool that guessed would occasionally delete a declaration of the integrator's own, and they
would find out later. It errs towards leaving work rather than removing theirs.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-COMP-005 — A step no command can take is named as a step the operator takes

🟢 The change to the integrator's own database is shipped as a file they run once, and the guide says
so rather than implying the command covered it.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-COMP-006 — An identifier a consumer may have written down is not renamed again

🟢 The names an application injects into SaaSiCat are part of the runtime contract. They were renamed
once, at 1.0, and that rename is part of what the major version paid for.

_Source:_ ADR 0002 · `CONTRIBUTING.md`

### SC-COMP-007 — A change that would otherwise be silent breaks the integrator's build instead

🟢 Where an integrator supplies their own data access, a new fact the platform depends on is required
rather than optional. An implementation that omitted the two cancellation dates could not tell a
subscription that ends next January from one that ended last January, and the quiet answer is that
it keeps everything.

_Source:_ `docs/guides/upgrade-to-1.0.md`

### SC-COMP-008 — An implementation offers only what it can actually answer

🟢 Declaring an operation and then failing inside it turned a recoverable fallback into a server
error on three tenant-facing routes. Where the underlying store cannot answer, the operation is
absent and the platform falls back.

_Source:_ release 1.0.0-rc.7

### SC-COMP-009 — Shipped source stays within a language level an integrator's toolchain can read

🟢 Their compiler reads it, not SaaSiCat's. Raising that floor breaks consumers below it and is a
deliberate, announced change — never a way to make a build pass.

_Source:_ `CONTRIBUTING.md`

### SC-COMP-010 — An integrator's own data access translates; it does not decide

🟢 Domain rules live above the storage layer, which is what keeps two implementations
interchangeable. An implementation that decides something — filtering on its own, defaulting a
status — moves a rule to where the other one does not have it.

_Source:_ ADR 0007

### SC-COMP-011 — Every data-access implementation is held to the same executable contract

🟢 Against a real database, covering the behaviours that only appear under concurrency. "Atomic"
means four different things to four implementations, and prose could not settle it.

_Source:_ ADR 0007

### SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded

🟢 Deliberately, rather than widened quietly and discovered by whoever chose the lagging one.

_Source:_ ADR 0007

### SC-COMP-013 — An installation whose store cannot hold a limit exactly does not start the enforcement

🟢 Enforcing a limit needs a store that can serialise a count and a write. An installation whose
store says it cannot is told at start-up rather than at the moment two customers slip past a
limit.

_Source:_ `docs/reference/options.md`

### SC-COMP-014 — The example application is kept in step with the platform

🟢 It is what an integrator copies from, and an outdated example teaches the wrong integration to
everyone who reads it.

_Source:_ `docs/explanation/test-coverage.md`

### SC-COMP-015 — A public interface is changed only after its consumers have been checked

🟢 Reusable components, exported types, configuration formats and extension points reach real
applications. Additive is preferred; a break is intentional and reflected in the release notes.

_Source:_ internal engineering guidelines

# ADR 0007 — Persistence and side effects go through ports

**Status:** accepted · **Date:** 2026-05-20

## Context

SaaSiCat is embeddable, not hosted: the application keeps its own database,
authentication and HTTP stack. The platform still needs to read and write plans,
contracts, audit entries and MFA secrets — in tables that live in the
application's schema, next to the application's own.

A platform that reaches for Prisma directly decides the consumer's ORM. One that
reaches for the consumer's repositories decides their domain model.

## Decision

Every persistence operation and every side effect is defined as a **port** — a
narrow interface owned by the platform — and bound to an **adapter** at module
registration. `@saasicat/adapter-prisma` provides the complete standard bundle
via `prismaPersistence()`; `@saasicat/adapter-drizzle` provides the core slices.

The contract is executable rather than described: `@saasicat/persistence-testing`
is a `node:test` suite every adapter must pass **against a real PostgreSQL**,
covering row locks, rollback, atomic promo redemption and tenant isolation. CI
runs it for both adapters.

An adapter translates; it does not decide. Domain rules live above it, which is
what keeps the adapters interchangeable.

## Alternatives considered

- **Prisma only.** Simpler, and it excludes every application that has already
  chosen otherwise — including the Drizzle consumer this decision was tested
  against.
- **A generic repository interface.** One `find`/`save` pair per entity reads as
  flexibility and delivers none: every non-trivial query becomes a leaked query
  object, and the semantics the contract tests (locking, atomicity) cannot be
  expressed at all.
- **Describe the contract in prose and trust adapters.** Tried in the first
  drafts. "Atomic" means four different things to four implementations, and the
  differences only appear under concurrency.

## Consequences

- **A new persistence capability is implemented in both adapters**, or the gap
  is recorded deliberately. `adapter-drizzle` already trails `adapter-prisma`;
  widening that silently is what the record exists to prevent.
- **A required port is required.** Where a port is genuinely optional the
  platform degrades — and degrading is never silent: it says what it turned off
  and why, once, at boot. A capability that vanishes without a word is
  indistinguishable from a bug in the consumer's code.
- The only raw SQL in the repository is the documented RLS bypass in
  `adapter-prisma`. `$queryRawUnsafe`/`$executeRawUnsafe` with interpolated
  values are not added.
- Testing the platform needs no database: ports are replaced with fakes. Testing
  an adapter needs a real one, because that is where the semantics live.

## What breaks if you ignore this

Platform code that imports a concrete adapter compiles and passes its unit
tests, and makes the package unusable for every consumer on another store — the
import pulls the whole ORM into their bundle whether they use it or not.

An adapter that decides something — filtering by tenant on its own, defaulting a
status — moves a domain rule below the contract, where the other adapter does
not have it. The contract suite is what catches the second half; nothing catches
the first except review.

# ADR 0002 — DI tokens use the global symbol registry

**Status:** accepted · **Date:** 2026-06-09

## Context

`@saasicat/nest` is bundled by tsup/esbuild into twelve entry points (`.`,
`./promo`, `./billing`, `./admin`, …), in both ESM and CommonJS. A module that
ends up in more than one output exists more than once at runtime, each copy with
its own module scope.

A DI token declared as `Symbol('MfaPort')` is therefore a _different_ symbol in
each copy. A provider registered through one entry point silently fails to
resolve when the token is imported from another — and it fails at boot, in the
consumer's application, with a message that names a token that looks correct.

That is not hypothetical. It cost a production outage on 2026-06-09.

## Decision

Any DI token that is, or may become, reachable from more than one entry point —
which includes every token a consumer app injects an adapter into — uses the
global symbol registry with the shared namespace:

```ts
export const MFA_PORT_TOKEN = Symbol.for('saasicat/nest/MfaPort');
```

`Symbol.for` resolves through the process-wide registry, so every copy of the
module agrees on the same symbol.

Plain `Symbol('X')` remains correct for a token created and consumed strictly
inside one entry point with no consumer-facing surface.

Every key is `saasicat/<package>/<Name>`, where `<package>` is the directory
under `packages/` the token is declared in.

## Alternatives considered

- **One entry point.** Removes the split at the source, and removes the reason
  the package has entry points: a consumer importing `@saasicat/nest/promo`
  would pull in the admin surface, the catalogue and everything else.
- **String tokens.** Nest accepts strings, which have no identity problem at
  all. Rejected: strings collide silently across packages, and the failure mode
  of a collision is worse than the one being fixed — a wrong provider resolves
  instead of none.
- **Class tokens everywhere.** Works for services, not for ports: a port is an
  interface, and an interface has no runtime value to use as a token.

## Consequences

- **Registry keys are a public contract.** A consumer may `Symbol.for` the same
  string in their own code, so an existing key is never renamed. They were
  renamed exactly once, at 1.0, when four historical prefixes became this one —
  that rename is part of what the major version paid for.
- The keys are readable at runtime, which makes a mismatch diagnosable:
  `Symbol.keyFor(token)` says which contract a token belongs to.
- Classes have no such registry, which is why `Symbol.for` alone is not enough.
  See [ADR 0003](0003-one-bundle-many-entries.md).

## What breaks if you ignore this

A provider registered through one entry point does not resolve through another.
The application compiles, the tests that load a single entry pass, and the boot
of a consumer app fails with `UnknownDependenciesException` naming a token that
is spelled correctly everywhere you look.

`tests/di-tokens-share-one-namespace.test.js` refuses any token declared with a
bare `Symbol()` that is exported from more than one entry, and any registry key
outside the `saasicat/<package>/` namespace.

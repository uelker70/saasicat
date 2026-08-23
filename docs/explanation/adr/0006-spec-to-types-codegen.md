# ADR 0006 — Wire types are generated from the schemas

**Status:** accepted · **Date:** 2026-05-28

## Context

The manifest, the plan catalog, promo codes and audit events cross a wire and a
language boundary: a backend writes them, an admin UI reads them, and
`@saasicat/spec` describes them as JSON Schema so that an implementation in any
language can be held to the same contract.

Two hand-written type definitions of the same payload drift. Not in a way that
fails a build — in a way that fails at runtime, in one direction, for one field.

## Decision

The DTO types for those payloads are **generated** from the JSON Schemas:

```bash
pnpm --filter @saasicat/core gen:types
```

The schema is edited, the types are regenerated, and both are committed.
`codegen-drift.test.js` regenerates in CI and fails the pull request when the
committed output does not match.

## Alternatives considered

- **Hand-write the types and review carefully.** The failure mode is a field
  that is optional in one place and required in the other, which review catches
  right up until the day it does not.
- **Generate the schemas from the types.** Reverses the dependency: the contract
  would then be whatever TypeScript happens to express, and a second language
  could not implement it without reading TypeScript.
- **Generate everything in `@saasicat/core`.** Attractive and wrong: most of
  that package is not a wire format.

## Consequences

- **Generation covers about 7% of the package** — 489 of 7,191 lines. The rest
  of `@saasicat/core` is hand-written on purpose: port interfaces, error codes,
  and 45 runtime exports that both sides need to agree on (`classifyPlanDiff`,
  `applyPromo`, `resolveErrorMessage`). Those are not payloads.
- A schema change is a contract change, and shows up as one in review: the diff
  contains both the schema and the regenerated file.
- Generated files are never hand-edited. The drift gate rejects it, and the edit
  disappears at the next generation regardless.

## What breaks if you ignore this

Editing a generated file makes the build red at the next CI run, which is the
cheap failure. The expensive one is editing the type without the schema: the
platform and a second implementation then disagree about a payload, and nothing
in either repository can see it.

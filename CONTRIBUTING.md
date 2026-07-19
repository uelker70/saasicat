# Contributing to saasicat

Thanks for contributing! This guide covers the workspace setup and the few rules
that are specific to this codebase.

## Setup

Requirements: **Node 24** (see `.nvmrc`) and **pnpm** via corepack.

```bash
corepack enable
pnpm install
pnpm -r build                              # REQUIRED before testing
pnpm -r --workspace-concurrency=1 test
```

**Build before test — always.** The test suites import from each package's compiled
`dist/` output, not from `src/`. Running tests against a stale or missing build
produces confusing failures (or false passes). The build is topological:
`spec → types → nest → { prisma, cli, ui-vue }`; `pnpm -r build` resolves the order
for you.

Tests run with `--workspace-concurrency=1` because parallel workers each bootstrap
NestJS test apps; running them serially keeps memory use sane.

Lint and formatting (`eslint`, `prettier`) configs at the repo root are binding —
run `pnpm lint` and `pnpm typecheck` before opening a PR.

## The `Symbol.for` rule for DI tokens

This is the most important codebase-specific rule. Violating it has caused a
production outage.

**Why:** `@saasicat/nest` is bundled by tsup/esbuild into **12 separate entry
points** (`.`, `./promo`, `./billing`, `./admin`, …) in both ESM and CJS. esbuild
only supports code splitting for ESM, so in the CJS build every shared module is
**copied into each entry chunk that imports it**. Each copy has its own module
scope — a token declared as plain `Symbol('X')` yields a *different* symbol in
every copy. A provider registered through one entry then silently fails to resolve
when injected via a token imported from another entry. The same double-identity
appears when a module is loaded once from `dist` and once from `src` (e.g. in
tests).

**The rule:**

- Any DI token that is (or may be) referenced from **more than one entry point** —
  which includes every token a consumer app injects an adapter into — MUST use the
  global symbol registry with the shared namespace:

  ```ts
  export const MFA_PORT_TOKEN = Symbol.for('saas-platform/MfaPort');
  ```

  `Symbol.for` resolves through the process-wide registry, so all bundle copies
  agree on the same symbol.

- Plain `Symbol('X')` is acceptable **only** for tokens created and consumed
  strictly within a single entry point, with no consumer-facing surface.

Note on the namespace: the registry keys use the historical `'saas-platform/…'`
prefix. These keys are part of the runtime contract between platform and consumer
apps — **do not rename existing keys**, and use the same prefix for new cross-entry
tokens unless a coordinated, breaking namespace migration is explicitly planned.

## Codegen: never edit generated types

The DTO types in `@saasicat/types` are **generated** from the JSON Schemas in
`@saasicat/spec`:

```bash
pnpm --filter @saasicat/types gen:types
```

A drift test (`codegen-drift.test.js`) regenerates the types in CI and fails the PR
if the committed output does not match the schemas.

Workflow for type changes: edit the schema in `@saasicat/spec`, run `gen:types`,
commit **both** the schema and the regenerated output. Hand-editing generated files
is never correct — the drift gate will reject it.

## Versioning and releases: Changesets (fixed group)

All packages are versioned in **lockstep** via a Changesets *fixed group* — one
version number across the whole set, no compatibility matrix.

Every user-facing change needs a changeset:

```bash
pnpm changeset
```

Pick a bump level (`patch` for fixes, `minor` for features; during 0.x, breaking
changes are also released as `minor`) and write a short, user-facing summary.
Internal-only changes (CI, tests, docs) don't need one. Publishing happens through
the release workflow in CI, not from local machines.

## Commits and pull requests

- Short, imperative subject line ("Add OTP lockout to registration"), body only
  when the *why* isn't obvious.
- One logical change per PR. Include the changeset when applicable.
- A PR is mergeable when `build`, `test`, `lint`, and `typecheck` are green.
- Reference related issues in the PR description.

## Security issues

Do not open public issues or PRs for vulnerabilities — see [SECURITY.md](SECURITY.md)
for private reporting.

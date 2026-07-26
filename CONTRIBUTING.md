# Contributing to SaaSiCat

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
points** (`.`, `./promo`, `./billing`, `./admin`, …) in both ESM and CJS. A module
that ends up in more than one chunk yields more than one copy, each with its own
module scope — a token declared as plain `Symbol('X')` is then a *different*
symbol per copy, and a provider registered through one entry silently fails to
resolve when injected via a token imported from another.

The build removes the largest source of that split (see **One bundle, many
entries** below), but not all of it: the ESM and CJS outputs are separate files,
so an app that reaches the package through both paths still sees two copies, as
does a test that loads a module once from `dist` and once from `src`. The rule
below is what makes tokens survive all of those cases.

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

## One bundle, many entries (the CJS build)

`Symbol.for` fixes tokens, but **classes have no such registry** — and Nest
resolves providers by class reference. Two copies of `MfaService` are two
different providers, so an app that takes `SetupModule` from `@saasicat/nest`
while `SaaSiCatModule` (from `@saasicat/nest/platform`) registers the admin
stack used to fail at boot with `UnknownDependenciesException`.

esbuild only code-splits ESM, so the CJS build is done in three passes:

1. `tsup.config.ts` — ESM (code-split, one identity) plus all `.d.ts`/`.d.cts`.
   Its CJS output is a placeholder.
2. `tsup.cjs.config.ts` — **one** CommonJS bundle, `dist/_entries.cjs`, built
   from the synthetic `src/_all-entries.ts` barrel.
3. `scripts/build-cjs-stubs.mjs` — overwrites each entry's `.cjs` with a thin
   re-export of the matching namespace from that bundle.

Every entry therefore hands out the same objects, in CJS as in ESM. Consumers
do not have to know which entry a class "really" lives in.

**When adding a public entry point**, update all four places together:
`package.json` `exports`, `tsup.config.ts` `entry`, the namespace list in
`src/_all-entries.ts`, and `ENTRY_NAMESPACES` in both `tsup.shared.ts` and
`scripts/build-cjs-stubs.mjs`. The stub script fails the build if the last two
drift apart, and `tests/cjs-entry-identity.test.js` fails if any export ends up
with two identities.

Two entries may still export the same NAME for different things on purpose —
`FEATURE_UI_REGISTRY_TOKEN` means a different registry in `billing` than in
`catalog`. Those are listed explicitly in that test.

## Layer boundaries in `@saasicat/ui-vue`

`packages/saas-platform-ui-vue/src` is layered: `client/` (framework-free) ←
`vue/` (no Quasar) ← `quasar/` + the SFC directories. Each layer has its own
package entry, and ESLint `no-restricted-imports` rules in the root config
enforce the boundaries — `pnpm exec eslint .` fails on an upward import.
New logic goes into a composable (`src/vue/`) or, when framework-free, into
`src/client/`; `.ts` files may import `quasar` only under `src/quasar/`.
Details: [`packages/saas-platform-ui-vue/README.md`](packages/saas-platform-ui-vue/README.md).

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

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
module scope — a token declared as plain `Symbol('X')` is then a _different_
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

### The shipped source has a language floor: ES2021

Several of that package's export subpaths — `pages/*`, `layouts/*`, `auth/*`, `ui/*`
— hand out `.vue` and `.ts` straight from `src/` instead of from a build, because
consumers need the source for Quasar and Sass theming. The list is not written here,
because it moves: `pages-standard/*` and `components/*` were two of them until phase 4
removed both, and `pages-tenant/*` left for `@saasicat/ui-vue-tenant` — which ships its
source under the same floor for the same reason. `check-shipped-source.mjs` derives the
list from the export map and prints the count on every run. So the **consumer's**
`tsconfig` compiles those files and everything they reach, including `src/client/` and
`src/vue/`. Ours says `lib: ES2023`; theirs may not.

Shipped code therefore stays within **ES2021**. In practice that rules out
`new Error(msg, { cause })` — use `attachCause()` from `src/client/attach-cause.ts` —
and `Object.hasOwn`, for which `Object.prototype.hasOwnProperty.call()` is the
equivalent. Code reached only through `dist/` is unaffected.

`pnpm --filter @saasicat/ui-vue test:shipped-source` compiles that closure at the floor
and runs in CI. It is set the way a Vite consumer sets it rather than to a bare language level:
`isolatedModules`, `useDefineForClassFields` and `strictPropertyInitialization`, the last
two of which this package's own base config would otherwise leave milder than its
subject. It
takes its directory list from the export map, so a new source-shipping subpath is covered
as soon as it exists, and a subpath whose shape the derivation cannot express fails the
check rather than being skipped.

**Minimum TypeScript: 5.0.** The check pins the library, not the compiler — `satisfies`
in the shipped source needs 4.9 or newer whatever `lib` says. This one is prose and named
as prose: verifying it would mean installing old compilers in CI.

Raising the floor breaks consumers below it — it is a deliberate, announced change, not a
way to make a build pass.

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

All packages are versioned in **lockstep** via a Changesets _fixed group_ — one
version number across the whole set, no compatibility matrix.

Every user-facing change needs a changeset:

```bash
pnpm changeset
```

Pick a bump level — `patch` for fixes, `minor` for features, `major` for a
breaking change — and write a short, user-facing summary. Internal-only changes
(CI, tests, docs) don't need one. Publishing happens through the release workflow
in CI, not from local machines.

### Opening the 1.0 release candidate

`0.27.0` is the current line. Phases 4 and 5 of the consolidation release together
as `1.0.0`, and the candidates leading up to it are tagged `rc`.

Two things open that line, and they have to arrive **in the same pull request**:

```bash
pnpm changeset          # pick `major`, describe the breaking change
pnpm changeset pre enter rc
```

Neither half works alone, and the release workflow runs on every push to `main`,
so the next merge publishes whatever the pair produces:

- **Pre mode without a `major`** appends the tag to the ordinary bump, so a
  `patch` versions the group as `0.27.1-rc.0` — a candidate line opened on the
  version being left behind.
- **A `major` without pre mode** applies the bump with no tag, so the release
  publishes a stable `1.0.0`. That version is reserved for the coordinated cut,
  and a published npm version cannot be taken back.

Together they give `1.0.0-rc.0`, after which every level accumulates as
`1.0.0-rc.N`. `pnpm run test:repo` refuses either half on its own.

Leaving pre mode is how `1.0.0` itself is released. It happens once, deliberately,
when the work behind the candidate is complete — not as part of an ordinary change.

## Commits and pull requests

- Short, imperative subject line ("Add OTP lockout to registration"), body only
  when the _why_ isn't obvious.
- One logical change per PR. Include the changeset when applicable.
- A PR is mergeable when `build`, `test`, `lint`, and `typecheck` are green.
- Reference related issues in the PR description.

**Do not stack pull requests.** Branch each one off `main` and merge it before
opening the next, or make it a single PR. This repository merges by squash, and a
stacked branch pays for that twice: `main` ends up with one commit describing the
same change your branch carries as many, so the next merge conflicts on files
neither of you meant to touch — and deleting the parent's branch on merge
_closes_ the child PR outright, because its base is gone. Rebuilding a stacked
branch on top of `main` afterwards is usually conflict-free, which is the tell
that the conflicts came from the shape rather than from the work.

## What is tested, and what is not

`pnpm run coverage` is a ratchet: it fails when coverage drops, and has no
threshold to reach. [`docs/test-coverage.md`](docs/test-coverage.md) says which
parts each suite exercises, names the adapters the persistence contract does not
reach, and ranks the remaining gaps by what a failure would cost rather than by
percentage. Read it before assuming a number means what it looks like — two
packages there carry two numbers each, for good reasons.

## Licensing of contributions

SaaSiCat is distributed under [PolyForm Shield 1.0.0](LICENSE): source-available, not OSI
open source. Reading, running, changing and redistributing it are permitted, as is building
and selling your own SaaS on it. The restriction is one sentence, quoted rather than
summarised:

> Any purpose is a permitted purpose, except for providing any product that competes with the software or any product the licensor or any of its affiliates provides using the software.

That covers the applications the author builds with SaaSiCat, not only SaaSiCat itself. The
reasoning is in [ADR 0001](docs/adr/0001-source-available-licensing.md).

That has one consequence for pull requests: by opening one you agree that your
contribution is licensed under the same terms, and that the project may relicense
it in future. Without that, the copyright would fragment across contributors and
no later licensing decision could be made at all.

## Security issues

Do not open public issues or PRs for vulnerabilities — see [SECURITY.md](SECURITY.md)
for private reporting.

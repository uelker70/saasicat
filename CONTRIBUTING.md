# Contributing to SaaSiCat

Thanks for contributing! This guide covers the workspace setup and the rules specific to this
codebase.

## Setup

Requirements: **Node 24** (see `.nvmrc`) and **pnpm** via corepack.

```bash
corepack enable
pnpm install
pnpm -r build                              # REQUIRED before testing
pnpm -r --workspace-concurrency=1 test
```

**Build before test — always.** The suites import each package's compiled `dist/`, not `src/`, so
a stale or missing build produces confusing failures or false passes. `pnpm -r build` resolves the
topological order. Tests run with `--workspace-concurrency=1` because every worker bootstraps
NestJS test apps; serially, memory use stays sane.

The lint and formatting configs at the repo root are binding. Before opening a PR, run `pnpm lint`,
`pnpm run lint:correctness`, `pnpm run lint:css`, `pnpm run lint:anti-slop` and `pnpm typecheck`.

- **`lint:correctness`** — oxlint's `correctness` category (very likely wrong or useless code)
  over every source, with no baseline: a finding is fixed. An intended one is switched off for
  exactly one line and one rule, with the reason: `// oxlint-disable-next-line <rule> -- <reason>`.
  Exclusions and why: [`oxlint.correctness.config.mts`](oxlint.correctness.config.mts). The
  type-aware rules (`oxlint-tsgolint`) read the built packages, so build first; they do not apply
  in `.vue`. `node scripts/oxlint-gegenprobe.mts` holds both, and that the exemptions reach no
  further than the configuration says.
- **`lint:anti-slop`** — counts the findings of the rules in [`oxlint.config.mts`](oxlint.config.mts)
  (type assertions without `// SAFETY:`, chained assertions, `Reflect.get`, module mocks and the
  rest, each with its reason there) plus the comments that switch one off, against
  `anti-slop-ratchet.json`: exact, and only down. No changed file may have more findings per rule
  than where your branch left `main`, and every finding on a new or changed line fails, an old one
  too — whoever touches a line fixes it. A necessary assertion gets a `// SAFETY:` line saying what
  makes it true. Removed findings are recorded with `pnpm run lint:anti-slop:update`. The plugin is
  a copy under `tools/oxlint/anti-slop/`; provenance and updating:
  [`UPSTREAM.md`](tools/oxlint/anti-slop/UPSTREAM.md).
- **`lint:css`** — Stylelint: does a CSS value come from the design system? Colour, shadow and type
  are errors; spacing, radii and tracking warn against the ceiling in the script, which only moves
  down ([ADR 0009](docs/explanation/adr/0009-three-layer-design-tokens.md)).

## The `Symbol.for` rule for DI tokens

The most important codebase-specific rule, because breaking it takes production down
([ADR 0002](docs/explanation/adr/0002-symbol-for-di-tokens.md)).

- Any DI token that is (or may be) referenced from **more than one entry point** — which includes
  every token a consumer app injects an adapter into — MUST use the global symbol registry with
  the shared namespace:

    ```ts
    export const MFA_PORT_TOKEN = Symbol.for('saasicat/nest/MfaPort');
    ```

- Plain `Symbol('X')` is acceptable **only** for tokens created and consumed strictly within a
  single entry point, with no consumer-facing surface.

Every key is `saasicat/<package>/<Name>`, `<package>` being the directory under `packages/` that
declares the token; `tests/di-tokens-share-one-namespace.test.js` refuses any other prefix. The
keys are part of the runtime contract with consumer apps: **do not rename an existing key**.

## One bundle, many entries (the CJS build)

Nest resolves providers by class reference and classes have no registry, while esbuild code-splits
only ESM — so the CommonJS build runs in three passes and every entry re-exports one shared bundle
([ADR 0003](docs/explanation/adr/0003-one-bundle-many-entries.md)).

**When adding a public entry point**, add it to `package.json` `exports` and its namespace to
`src/_all-entries.ts`. The tsup entry list, the stub generator and the identity test read the
entries from `exports` (`scripts/entries.mjs`); `scripts/build-cjs-stubs.mjs` fails the build when
`src/_all-entries.ts` lacks an exported entry's namespace, and `tests/cjs-entry-identity.test.js`
fails if an export ends up with two identities. No two entries export the same name for different
things.

## Layer boundaries in `@saasicat/ui-vue`

`packages/ui-vue/src` is layered: `client/` (framework-free) ← `vue/` (no Quasar) ← `quasar/` + the
SFC directories, each with its own package entry. ESLint `no-restricted-imports` in the root config
fails `pnpm exec eslint .` on an upward import. New logic goes into a composable (`src/vue/`) or,
when framework-free, `src/client/`; `.ts` files import `quasar` only under `src/quasar/`. Why:
[ADR 0004](docs/explanation/adr/0004-ui-vue-layer-boundaries.md); details:
[`packages/ui-vue/README.md`](packages/ui-vue/README.md).

### The shipped source has a language floor: ES2021

Some subpaths of that package hand out `.vue` and `.ts` from `src/` under the `types` condition (a
bundler follows `default` into `dist/`), and `@saasicat/ui-vue-tenant` ships only source. A new
subpath serves source when a consumer's `tsc` has to see it, not because of how it is bundled
([ADR 0005](docs/explanation/adr/0005-ship-sfc-source-not-dist.md), superseded in part by
[ADR 0011](docs/explanation/adr/0011-admin-ui-bundles-quasar.md), the half that matters when you
add a subpath). The **consumer's** `tsconfig` compiles those files and everything they reach,
`src/client/` and `src/vue/` included — so shipped code stays within **ES2021**: no
`new Error(msg, { cause })` (use `attachCause()` from `src/client/attach-cause.ts`) and no
`Object.hasOwn` (use `Object.prototype.hasOwnProperty.call()`). Code reached only through `dist/`
is unaffected.

`test:shipped-source` in both packages compiles that closure at the floor in CI, configured as a
Vite consumer sets it (`isolatedModules`, `useDefineForClassFields`,
`strictPropertyInitialization`). It derives the subpaths from the export map and prints their
count, so a new one is covered as soon as it exists, and one whose shape the derivation cannot
express fails the check rather than being skipped. **Minimum TypeScript: 5.0** — prose, named as
prose, because the check pins the library and not the compiler (`satisfies` needs 4.9 or newer).
Raising the floor breaks consumers below it: a deliberate, announced change, never a way to make a
build pass.

## Codegen: never edit generated types

The DTO types in `@saasicat/core` are **generated** from the JSON Schemas in `@saasicat/spec` —
about 7% of the package; [ADR 0006](docs/explanation/adr/0006-spec-to-types-codegen.md) says which
and why the rest is hand-written. Edit the schema, run `pnpm --filter @saasicat/core gen:types`, and
commit **both**. Hand-editing generated files is never correct: `codegen-drift.test.js` regenerates
them in CI and fails the PR on any difference.

## The requirements catalogue is generated

[`docs/requirements.md`](docs/requirements.md) is built from `requirements/`; edit the sources,
never the page. `pnpm run requirements` checks them, `pnpm run requirements:update` rebuilds the
page, and `tests/requirements-are-generated.test.js` fails when the two drift.

**An identifier is permanent, and a promise is not edited into a different promise**, because
somebody outside this repository may have written the identifier down. A promise that now holds
differently is superseded — ``_(Superseded on YYYY-MM-DD by `SC-…`.)_`` — and the new wording
becomes a new entry; one dropped with nothing in its place is `_(Withdrawn on YYYY-MM-DD.)_`. A
typo or a clearer sentence is edited in place and claimed in its commit (`Editorial: SC-PLAN-004`).
`pnpm run requirements:guard` judges each commit against `main`, and CI runs it on every pull
request.

**A test names the promises it answers for**, on the narrowest thing that is true:

```js
// @requirement SC-BUN-003
describe('what the short first period costs', () => {
```

Write the identifier only; `requirements:update` writes the title and the covering cases — never
type either by hand. The checks cannot tell whether a test proves what it names; that judgement is
yours and your reviewer's. The proof debt is frozen: a new promise brings its test, or a promise
owed one gains a test, and a proved promise may not lose its proof. A second ratchet runs beside
it, over the same population and with the same fungible credit: a promise that claims every case —
"never", "every", "only", "uniformly" — has a test or says in the entry where the absolute stops.

The rules, the states and what each check refuses: [`requirements/README.md`](requirements/README.md);
the reasoning: [`docs/explanation/requirements-as-sources.md`](docs/explanation/requirements-as-sources.md).

## Versioning and releases: Changesets (fixed group)

All packages are versioned in **lockstep** through a Changesets _fixed group_ — one version number,
no compatibility matrix. Every user-facing change needs a changeset (`pnpm changeset`) with a
short, user-facing summary; internal-only changes (CI, tests, docs) don't. Never edit a `version`
field — Changesets writes them.

Until the stable `1.0.0`, only `patch` (fixes) and `minor` (features) are written — never `major`.
A breaking change is `minor`, with its section in
[`docs/guides/upgrade-to-1.0.md`](docs/guides/upgrade-to-1.0.md) and, where the change is
mechanical, its step in the codemod that guide names (`saasicat codemod v1`); otherwise the guide
names the manual step. The group is in pre mode with the tag `rc`, opened by
`pnpm changeset pre enter rc`: every level releases the next `1.0.0-rc.N`, and any candidate may
break on those terms. Leaving pre mode releases `1.0.0`. When that happens, and what may break
after it, is the maintainer's decision (#339) — never part of an ordinary change.

Publishing happens through the release workflow in CI, not from local machines. The steps a
maintainer takes by hand — a new package's first publish, its trusted publisher, the `rc` dist-tag —
are in [Maintaining releases](docs/guides/maintain-releases.md).

## Commits and pull requests

- Short, imperative subject line ("Add OTP lockout to registration"), body only when the _why_
  isn't obvious.
- One logical change per PR. Include the changeset when applicable.
- A PR is mergeable when `build`, `test`, `lint`, and `typecheck` are green.
- Reference related issues in the PR description.

CI runs on every pull request and again on the merge to `main`, which skips its checks where a
successful pull request run tested the same tree
(`.github/scripts/tree-tested-by-a-pull-request.sh`). Where `main` moved since, the lookup fails, or
the run is a `workflow_dispatch`, every check runs. A newer push to a pull request cancels the older
run.

**Do not stack pull requests.** A stack is a branch cut from another, unmerged branch — retargeting
its PR at `main` does not remove the parent's commits. If `git log --oneline main..HEAD` holds work
of another open pull request, you have one. Branches cut from `main` are not a stack, however many
are open: work on independent things in parallel, merge in any order. A stack costs conflicts,
because this repository merges by squash, and deleting the parent's branch on merge _closes_ the
child. A second branch that genuinely needs the first should have been one pull request.

## What is tested, and what is not

`pnpm run coverage` is a ratchet: it fails when coverage drops and has no threshold to reach. It
rebuilds only packages whose inputs changed (a stamp in `dist/`, `scripts/build-stamp.mjs`), so it
is cheap after every change. Before assuming a number means what it looks like, read
[`docs/explanation/test-coverage.md`](docs/explanation/test-coverage.md): what each suite exercises,
which adapters the persistence contract does not reach, the gaps ranked by what a failure would
cost, and why two packages carry two numbers each.

### Migrations are applied twice

The `.sql` files under `@saasicat/spec/sql/` are shipped for a consumer to apply by hand or from an
entrypoint script, and nothing keeps a migration ledger, so a retried deploy, a restarted container
or a re-run pipeline step applies them again. A second run therefore does nothing, or refuses with a
sentence saying why — never an unexplained database error, never a second application of the same
effect. For DDL: `IF EXISTS`/`IF NOT EXISTS` plus a check for the state already being reached; for a
backfill: a marker or a condition that stops matching after the first run.

`pnpm --filter @saasicat/spec test:integration` (needs `SAASICAT_TEST_DATABASE_URL`; CI job
`persistence-contract`) builds the shipped reference schema, applies every other `sql/*.sql` twice
— taken from the directory, so a new file is covered unlisted — and fails when the second run raises
or moves the schema the first one settled.

## Licensing of contributions

SaaSiCat is distributed under [PolyForm Shield 1.0.0](LICENSE): source-available, not OSI open
source. Reading, running, changing and redistributing it are permitted, as is building and selling
your own SaaS on it. The restriction is one sentence, quoted rather than summarised:

<!-- markdownlint-disable MD013 -- quoted verbatim; a guard keeps it word for word -->

> Any purpose is a permitted purpose, except for providing any product that competes with the software or any product the licensor or any of its affiliates provides using the software.

<!-- markdownlint-enable MD013 -->

That covers the applications the author builds with SaaSiCat, not only SaaSiCat itself
([ADR 0001](docs/explanation/adr/0001-source-available-licensing.md)). By opening a pull request you
agree that your contribution is licensed under the same terms and that the project may relicense
it; otherwise the copyright would fragment and no later licensing decision could be made.

### What a dependency brings with it

Nothing SaaSiCat depends on may put conditions on an integrator's own code (`SC-SEC-012`).
`tests/dependency-licences-leave-the-integrators-code-alone.test.js` walks every dependency and peer
dependency of the published packages, all the way down, and refuses any licence missing from
[`scripts/dependency-licences.mjs`](scripts/dependency-licences.mjs) — copyleft, and any it cannot
read. Adding a licence to that list is the decision to make before the dependency is added, not
after.

A file copied from another package into a published one goes through
[`packages/ui-vue/scripts/vendor-copies.mjs`](packages/ui-vue/scripts/vendor-copies.mjs), which ships
every licence governing it beside it (`SC-SEC-017`); the licence test reads that source package too.
A licence text counts only when it matches one in [`scripts/licence-texts/`](scripts/licence-texts/)
word for word, apart from title and copyright notices; anything else fails until somebody has read
it, and an accepted licence gets its text there. A notice file ships as it is and is not judged:
the terms are what the licence files state.

## Security issues

Do not open public issues or PRs for vulnerabilities — see [SECURITY.md](SECURITY.md) for private
reporting.

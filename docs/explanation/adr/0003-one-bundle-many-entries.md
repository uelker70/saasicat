# ADR 0003 — One CommonJS bundle behind many entry points

**Status:** accepted · **Date:** 2026-06-20

## Context

[ADR 0002](0002-symbol-for-di-tokens.md) fixes token identity across bundle
copies. Classes have no equivalent registry, and Nest resolves providers by
class reference: two copies of `MfaService` are two different providers.

esbuild code-splits ESM and does not code-split CommonJS. So the ESM output has
one copy of each shared module, and a naive CommonJS build has one copy per
entry point. An application that took `SetupModule` from `@saasicat/nest` while
`SaaSiCatModule` — from `@saasicat/nest/platform` — registered the admin stack
failed at boot with `UnknownDependenciesException`, because the two entries had
different `SetupService` classes.

## Decision

The CommonJS output is built in three passes:

1. `tsup.config.ts` — ESM (code-split, one identity) plus all `.d.ts`/`.d.cts`.
   Its CommonJS output is a placeholder.
2. `tsup.cjs.config.ts` — **one** CommonJS bundle, `dist/_entries.cjs`, built
   from the synthetic barrel `src/_all-entries.ts`.
3. `scripts/build-cjs-stubs.mjs` — overwrites each entry's `.cjs` with a thin
   re-export of the matching namespace from that bundle.

Every entry therefore hands out the same objects, in CommonJS as in ESM, and a
consumer never has to know which entry a class "really" lives in.

## Alternatives considered

- **Ship ESM only.** Removes the problem entirely and removes the consumers
  that still require CommonJS, including tooling that loads a Nest module
  synchronously. Not yet.
- **Externalise every shared module.** Would need a real internal package per
  shared unit, published or not, and a resolution story for both module systems.
  More machinery than the stub script, for the same outcome.
- **Tell consumers to import from one entry.** Tried, in prose. A rule that
  produces a boot failure when broken and nothing when kept is not a rule, it is
  a trap.

## Consequences

- **A new public entry point touches four places together:** `exports` in
  `package.json`, `entry` in `tsup.config.ts`, the namespace list in
  `src/_all-entries.ts`, and `ENTRY_NAMESPACES` in both `tsup.shared.ts` and
  `scripts/build-cjs-stubs.mjs`.
- **No two entries export the same name for different things.** One pair did
  until 1.0 — `FEATURE_UI_REGISTRY_TOKEN` meant one registry in `billing` and
  another in `catalog` — and the identity test carried it as an exception. They
  are `BILLING_FEATURE_UI_REGISTRY_TOKEN` and `CATALOG_FEATURE_UI_REGISTRY_TOKEN`
  now, and the test has no exception list.
- The ESM and CommonJS outputs remain two module instances of the package. That
  is the second reason tokens go through the global registry.

## What breaks if you ignore this

Adding an entry point to `package.json` alone produces a `.cjs` file that is a
second copy of everything it exports. Consumers who mix that entry with another
get two classes of the same name, and Nest reports a missing dependency for a
provider that is plainly registered.

`scripts/build-cjs-stubs.mjs` fails the build when the two namespace lists
drift apart, and `packages/nest/tests/cjs-entry-identity.test.js` fails when any
export resolves to two identities.

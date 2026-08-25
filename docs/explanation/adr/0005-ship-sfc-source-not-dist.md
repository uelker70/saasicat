# ADR 0005 — Ship the SFC source, not a build

**Status:** superseded in part by [ADR 0011](0011-admin-ui-bundles-quasar.md) ·
**Date:** 2026-07-10

`@saasicat/ui-vue` builds its components now: the runtime half of this record no
longer describes it. What still holds, and why it is not simply replaced — the
premise that expired was Quasar's Sass variables, and ADR 0011 says which
measurement retired it.

Two parts of this record are still live. `@saasicat/ui-vue-tenant` ships nothing
but source, for the reason below. And the **language floor** governs both
packages: `@saasicat/ui-vue` still hands out its `.vue` sources for TypeScript
through the `types` condition, so a consumer's compiler still reads them and
ES2021 is still the ceiling.

## Context

The admin pages are Quasar components. A consumer themes them through Quasar's
Sass variables and through the design tokens, and both of those are resolved by
_their_ build, not ours. A compiled `.js` bundle has already made those
decisions and cannot take them back.

## Decision

Several export subpaths of `@saasicat/ui-vue` — `pages/*`, `layouts/*`,
`auth/*`, `ui/*` — hand out `.vue` and `.ts` straight from `src/`.
`@saasicat/ui-vue-tenant` ships nothing but source, for the same reason.

The list is not written down anywhere in prose, because it moves:
`check-shipped-source.mjs` derives it from the export map and prints the count
on every run.

Because those files are compiled by the **consumer's** `tsconfig`, the shipped
source and everything it reaches — which includes `src/client/` and `src/vue/` —
stays within **ES2021**, and TypeScript 5.0 is the minimum compiler.

## Alternatives considered

- **Ship `dist/` like every other package.** Theming would then require
  overriding compiled CSS from outside, which is exactly the fragile,
  specificity-fighting arrangement the theme layer exists to avoid.
- **Ship both.** Two module instances of the same components, and a consumer
  who reaches one path in the app and the other in a test gets two copies of
  every injection key. The single-source rule is cheaper than the debugging.
- **Compile to ES2015 to be safe.** A floor low enough to never break anyone is
  also low enough to lose `??`, `?.` and top-level `await` in our own code. The
  floor is set where the consumers are, and moving it is announced.

## Consequences

- **`dist/` and `src/` are two module instances of this package.** A consumer
  who reaches both — an app importing `@saasicat/ui-vue` and a page importing
  `@saasicat/ui-vue/pages/UsersPage.vue` — has two copies of any module-scoped
  value. That is why injection keys use `Symbol.for` as well, and why
  `injection-keys-are-global-symbols.test.js` exists.
- **ES2022 constructs are a build failure in someone else's repository.** It
  happened: `new Error(msg, { cause })` in `admin-error.ts` broke
  `autohauspro/frontend` at 0.26.0. Use `attachCause()` from
  `src/client/attach-cause.ts`, and
  `Object.prototype.hasOwnProperty.call()` rather than `Object.hasOwn`.
- The consumer's build gets slower by the size of what it compiles, and their
  linter sees our source. Both are accepted.

## What breaks if you ignore this

`pnpm --filter @saasicat/ui-vue test:shipped-source` compiles the closure at
ES2021 with `isolatedModules`, `useDefineForClassFields` and
`strictPropertyInitialization` set the way a Vite consumer sets them — stricter
than this package's own base config in the last two. It runs in CI, and
`@saasicat/ui-vue-tenant` has the same check.

Without it, the failure appears for the first time in a consumer's build, after
a release, in a file they did not write.

# ADR 0004 — Three layers in `@saasicat/ui-vue`

**Status:** accepted · **Date:** 2026-07-02

## Context

The admin UI package holds three kinds of code with three different
dependencies: logic that needs nothing (URL building, error normalisation,
resource descriptors), logic that needs Vue (composables, stores), and code that
needs Quasar (dialogs, notifications, the app factory).

Mixed together, the framework-free half becomes untestable without mounting a
component, and the Vue half becomes unusable for a consumer on a different
component library.

## Decision

`packages/ui-vue/src` is layered, and each layer may only import downwards:

```text
client/   framework-free  ←  vue/   (Vue, no Quasar)  ←  quasar/ + the SFC directories
```

Each layer has its own package entry, so a consumer can take `client/` alone.
The boundaries are enforced by `no-restricted-imports` rules in the root ESLint
config; `pnpm exec eslint .` fails on an upward import. A `.ts` file may import
`quasar` only under `src/quasar/`.

New logic goes into a composable in `src/vue/`, or, when it needs no framework,
into `src/client/`.

## Alternatives considered

- **One flat `src/`.** What it was. The framework-free logic could not be
  tested or reused without Vue, and nothing stopped a `client/` file importing
  `quasar` — which happened.
- **Separate packages.** Real enforcement, at the cost of three publish targets,
  three versions in the fixed group and a circular-dependency risk during
  development. The ESLint rule gives the same guarantee inside one package.

## Consequences

- The layer a file is in decides what it may use, and that is visible from its
  path alone — which is the point.
- A composable that needs a dialog takes a port (`UiConfirm`, `UiNotify`)
  instead of calling Quasar, so an app with its own modal system replaces the
  port rather than the page.
- Some code is one indirection longer than it would be otherwise. Accepted: the
  indirection is what makes the same logic reachable from a page, a test and a
  consumer's own component.

## What breaks if you ignore this

An upward import compiles and works — in this repository. It breaks for the
consumer who imported `@saasicat/ui-vue/client` expecting no framework and got a
Quasar plugin registration at import time, and it breaks the unit tests that
run the client layer without a DOM.

The rule fails the lint step, not the type-check, so a green `tsc` says nothing
about it.

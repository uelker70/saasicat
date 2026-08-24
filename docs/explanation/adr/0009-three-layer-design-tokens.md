# ADR 0009 — Three token layers, and what may live in each

**Status:** accepted · **Date:** 2026-08-13

## Context

The admin UI had a token system and 644 hard-coded hex values, 198 `rgba()`
literals, 80 distinct pixel values and 23 font sizes beside it. Both were true
at once: the tokens existed, and nothing made them the way to get a colour.

Dark mode is what made the arrangement untenable. Adding a second theme to a
token layer is one file; adding it to 62 files with literals in them is not a
task anybody finishes.

## Decision

Three layers under `src/ui/theme/`, each with one job:

| Layer | File                                      | May contain                                    |
| ----- | ----------------------------------------- | ---------------------------------------------- |
| L1    | `tokens.primitive.css`                    | **only** literals — the raw palette and scales |
| L2    | `tokens.scale.css`                        | **no** literals — references into L1           |
| L3    | `tokens.semantic.light.css` / `.dark.css` | role names, referencing L1 and L2              |

Components and pages read L3 role names. A `.vue` file contains no hex value,
no `rgba()`, no ad-hoc pixel value, no font size and no breakpoint.

## Alternatives considered

- **Two layers (primitive + semantic).** What existed. Without the scale layer
  every semantic role picks its own step, and the steps drift — which is how a
  system ends up with 23 font sizes.
- **Sass variables.** Resolved at build time, so a runtime theme switch is
  impossible and a consumer cannot override a role without rebuilding the
  package.
- **A theme object in JavaScript.** Then CSS cannot read it without a runtime
  bridge, and the bridge is a second source of truth.

## Consequences

- **Dark mode is one file.** That is the payoff, and it was measured: after the
  migration the dark theme was a single semantic file with no component changes.
- **Where a custom property is declared decides where it resolves.** Quasar's
  `setCssVar` writes to `<body>` by default, so a role computed on `:root` never
  sees it, and an override on `:root` does not reach the dark roles because
  those are declared under `body.body--dark` — below it. The same mechanic
  carries the other way: because the dark roles sit on the body, one
  `body { background: var(--sa-color-bg-app) }` serves both themes.
- **Both themes declare the same keys.** A role that exists in one and not the
  other is invisible until someone switches.
- Consumers restyle by overriding L3 role names, and the design guide says which
  ones and what the contrast floor is.

## What breaks if you ignore this

A literal in a `.vue` file is invisible in dark mode until a person looks at
that page in dark mode. That is the whole failure class: it never fails a build,
it fails a screenshot nobody takes.

Three guards hold the layers: `theme-layer-discipline.test.js` (L2 carries no
literals, L1 nothing else), `theme-token-parity.test.js` (both themes declare
the same `--sa-color-*` keys, and every referenced role is declared in both),
and `theme-role-contrast.test.js` (roles meet 3:1, body text 4.5:1).
`pnpm tokens` counts what is left and is a ratchet — it only moves down.

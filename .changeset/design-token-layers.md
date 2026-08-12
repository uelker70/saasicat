---
'@saasicat/ui-vue': minor
'create-saasicat-admin': minor
---

Three token layers, one colour system, and a dark theme

The admin UI shipped a token file **and** 643 literal colours, 198 `rgba()`
literals and 23 font sizes. A reader could not tell which value was a decision
and which was a guess, so every new page guessed again. All four counts are now
zero, and the audit (`pnpm run tokens`) keeps them there.

**The layers.** `@saasicat/ui-vue/theme.css` is the new entry
(`./sa-theme.css` still works and is removed in 1.0):

- **L1 primitives** — the palette and the scales. Reference nothing.
- **L2 roles** — `--sa-color-fg-muted`, `--sa-color-negative-surface`, … The
  only layer that differs between light and dark.
- **L3 components** — the shell chrome, reading roles.

A component asks for a role, never for a value. That single rule is what makes
the dark theme one file instead of sixty-two, and it is enforced: primitives may
reference nothing, roles may hold no literal, and nothing outside the role layer
may name a palette colour.

**One brand, not two.** `--sa-color-accent` reads Quasar's `--q-primary`, which
comes from your `$primary`. Set it once and the hero, the buttons, the focus
ring, the tinted surfaces, Quasar's own components and the tenant-facing pages
all follow. Previously the platform painted `#3f6bff` while a scaffolded app
painted `#1e40af`, in the same screen, because each had its own source of truth.
`setCssVar('primary', …)` works at runtime too.

**Dark mode.** `createSuperAdminApp({ theme: { scheme: 'system' } })`, plus
`useSaTheme()` anywhere. `'system'` follows the operating system live. Quasar's
own `$q.dark.set(true)` flips the platform as well, so an app that already has a
dark switch needs nothing from this. Verified on all nineteen standard pages by
a contrast check rather than by a second set of screenshots: the canvas must get
darker, most text colours must move, and nothing may fall under 3:1 in either
theme.

**Also:** the spacing, type, radius, shadow, z-index and breakpoint scales;
`--sa-radius-pill`; and a fix for `--sa-color-fg-subtle`, which was reading
2.56:1 on a white card — captions and price units were decoration rather than
information.

## What you may need to do

**If you embed `@saasicat/ui-vue/pages-tenant/*` in your own app**, add one
import to that app's entry:

```ts
import '@saasicat/ui-vue/theme.css';
```

Those pages used to carry their own colours and their own dark theme; they read
the shared roles now, which is what lets one `$primary` brand both surfaces. The
stylesheet is safe to load beside your own design — it declares custom
properties and `.sa-*` classes, and every rule is scoped under `.sa-page`.

**If you override an `--sa-*` variable in your own CSS**, reading still works;
setting no longer does. The old names are aliases of the roles now. Set
`$primary` for the brand, or override the `--sa-color-*` role directly.

**Expect a visual change.** Colours that were three near-identical greens
collapse to one success colour, the same for the browns and the reds; the type
scale snaps 23 sizes onto nine; and the admin adopts your `$primary` instead of
the platform's blue.

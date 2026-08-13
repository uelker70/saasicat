---
'@saasicat/ui-vue': minor
'create-saasicat-admin': minor
---

Three token layers, one colour system, and a dark theme

The admin UI shipped a token file **and** 643 literal colours, 198 `rgba()`
literals and 23 font sizes. A reader could not tell which value was a decision
and which was a guess, so every new page guessed again. Hex colours, `rgb()`
and `hsl()` literals, named colours and raw font sizes are all at zero now, and
the audit (`pnpm run tokens`) keeps them there. What it still reports is 56
colours built in script (inline `:style` bindings) and 70 distinct pixel values
— known debt, held under a ratchet so it can only shrink.

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
To change the brand at runtime, write to the root:
`setCssVar('primary', value, document.documentElement)`. The third argument is
not optional — Quasar's default target is `<body>`, and the accent role is
computed on `:root`, which cannot see a value declared below it.

**Dark mode.** `createSuperAdminApp({ theme: { scheme: 'system' } })`, plus
`useSaTheme()` anywhere. `'system'` follows the operating system live. Quasar's
own `$q.dark.set(true)` flips the platform as well, so an app that already has a
dark switch needs nothing from this. Verified on all nineteen standard pages by
a contrast check rather than by a second set of screenshots: the canvas must get
darker, most text colours must move, and nothing may fall under 3:1 in either
theme.

The stylesheet itself does **not** answer `prefers-color-scheme`, deliberately.
It paints the platform's surfaces while Quasar paints its own cards, dialogs and
steppers, and Quasar follows only `body--dark` — so a media query there moves
one half of the screen and leaves the other. Following the OS lives in
`createSaTheme`, where the bridge moves both. An app that embeds tenant pages
and wants OS-following dark opts in with
`bindSaThemeToDocument(createSaTheme())`.

**Also:** the spacing, type, radius, shadow, z-index and breakpoint scales;
`--sa-radius-pill`; and a fix for `--sa-color-fg-subtle`, which was reading
2.56:1 on a white card — captions and price units were decoration rather than
information.

**Teleported dialogs and menus are themed too.** Quasar appends every dialog,
menu and tooltip to `<body>`, outside the `.sa-page` wrapper — so the theme
never reached them, and dialog cards kept Quasar's grey surface, its 4px radius
and its transparent outlined inputs, while every dropdown opened a `#1d1d1d`
panel over a slate page. `createSuperAdminApp` now marks those portals
(`config.globalNodes.class`, appended to yours if you set one) and the theme
addresses `.sa-page` and `.sa-portal` alike.

Be aware of the scope: `globalNodes` is document-wide, not per-owner. Every
portal opened inside an app bootstrapped by `createSuperAdminApp` is marked —
including a dialog opened by a page you contribute into the admin shell. That is
intended, because a page mounted in the shell is admin UI, and `.sa-page`
already repaints its cards. An app that does not call `createSuperAdminApp` is
untouched. Tooltips keep Quasar's own colours.

**Quieter row actions.** Table row icons were three different recipes across
five pages — two painted `primary`, two carried a per-action colour, one had its
own class — so one table read as a row of traffic lights beside another's row of
greys. They share `.sa-icon-btn` now: muted by default, colour reserved for the
destructive action. Rows of actions are chrome, not announcements. And the plan
list stretches its cells to a common height, so the hover band no longer
notches where a column happens to be shorter.

## What you may need to do

**If you embed `@saasicat/ui-vue/pages-tenant/*` in your own app**, add one
import to that app's entry:

```ts
import '@saasicat/ui-vue/theme.css';
```

Those pages used to carry their own colours and their own dark theme; they read
the shared roles now, which is what lets one `$primary` brand both surfaces. The
stylesheet is safe to load beside your own design — every selector in it is
either a `.sa-`-prefixed class of ours or sits under `.sa-page`, and there is no
bare element rule.

**If you override an `--sa-*` variable in your own CSS**, reading still works;
setting no longer does. The old names are aliases of the roles now. Set
`$primary` for the brand — that is the whole answer for the common case.

To override a **role**, write both of its values, on the same selectors the
theme uses:

```css
:root {
    --sa-color-negative: #a3122b;
}
[data-sa-theme='dark'],
body.body--dark {
    --sa-color-negative: #ff6b81;
}
```

A role has two values, so an override has two. `:root` alone is not enough and
fails differently per trigger — under Quasar's `body--dark` the roles are
declared on `<body>`, and an inherited `:root` value never reaches past that.
See the design guide.

**Expect a visual change.** Colours that were three near-identical greens
collapse to one success colour, the same for the browns and the reds; the type
scale snaps 23 sizes onto nine; and the admin adopts your `$primary` instead of
the platform's blue.

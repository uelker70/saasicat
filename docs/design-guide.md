# Design guide

For the developer building an admin page that has to stand next to SaaSiCat's
own nineteen and not look like a guest.

It is not a component catalogue. It is a recipe, a set of decision rules, and
the token reference those rules point at. The catalogue follows from the recipe:
if you know which block you are writing, you know which component renders it.

- [The page recipe](#the-page-recipe)
- [Decision rules](#decision-rules)
- [Colour roles](#colour-roles)
- [Dark mode](#dark-mode)
- [The scales](#the-scales)
- [Writing CSS in a page](#writing-css-in-a-page)
- [Accessibility baseline](#accessibility-baseline)

---

## The page recipe

Every standard page is the same five blocks in the same order. A page that
deviates is saying something — make sure it is something.

```vue
<template>
    <AdminPage>
        <!-- 1. Identity. The one <h1>. Page-level actions, nothing else. -->
        <AdminHero :title="msg.title" :subtitle="msg.subtitle">
            <template #actions>
                <AdminRefreshBtn :loading="list.pending.value" @refresh="list.reload" />
            </template>
        </AdminHero>

        <!-- 2. Scalars, if there are any. Never more than five. -->
        <AdminStatistics>
            <AdminKpi v-for="k in kpis" :key="k.key" v-bind="k" />
        </AdminStatistics>

        <!-- 3. Content. Loading and empty are states of the body, not of the page. -->
        <AdminBody :loading="list.pending.value" :empty="list.items.value.length === 0">
            <AdminSection :title="msg.section.title">
                <AdminFilters><!-- inputs --></AdminFilters>
                <AdminTable :rows="list.items.value" :columns="columns" storage-key="things" />
            </AdminSection>
        </AdminBody>

        <!-- 4. Overlays. Siblings of the body, never inside a section. -->
        <ThingFormDialog v-model="createOpen" @submitted="list.reload" />
    </AdminPage>
</template>
```

`AdminPage` carries the frame, `AdminHero` the identity, `AdminSection` the
surface. Nothing else in the package renders an `<h1>`, and no page writes its
own `<q-table>` — both are enforced by `tests-component/admin-page-shell.test.ts`,
which reads the source of every page and fails on a violation.

> **Not yet in the roster.** The banner, empty-state, dialog and row-action
> primitives named in the plan arrive with the Phase 4 directory move. Until
> then a page writes those by hand; when they land, the recipe gains a
> `<AdminErrorBanner>` under the hero and an `<AdminEmptyState>` in the body's
> `#empty` slot. Everything else above is what ships today.

---

## Decision rules

**A section, or another page?**
A section is another _view of the same subject_ — the same nouns, and the same
filters would apply. A page is a _different subject, or something somebody would
bookmark_. Test: if the user would say "show me X" and expect the back button to
return them, it is a page; if they would say "and also…", it is a section.

**Where does a filter live?**
In the `AdminSection` that owns the filtered list, as its first child, wrapped in
`AdminFilters`. Never in the hero — that is identity and page actions. _A filter
that governs two sections means those two sections are one._

**How do I show a failure?**
Where the user was looking. Three cases, no fourth:

1. The page could not load → a banner under the hero; the body stays in its
   loading or empty state.
2. A mutation failed while a dialog is open → the dialog says so.
3. A mutation failed and there is nothing on screen to attach it to → a toast,
   raised through the `UiNotify` port.

Never a toast for a failed load. Never a toast for something already visible.

**A KPI, or a section?**
A KPI is _one_ scalar with a trend or a link. Three or more related scalars with
dimensions are a table in a section. Never more than five KPIs in a row.

---

## Colour roles

You never pick a colour. You say what the thing **is**, and the role answers.
The palette underneath (`--sa-neutral-500`, `--sa-red-600`, …) is not yours to
name: it does not change between themes, so a component that reads it is right
in light mode and wrong in dark. The layer test fails the build if one does.

### Surfaces and text

| Role                           | For                                                                         |
| ------------------------------ | --------------------------------------------------------------------------- |
| `--sa-color-bg-app`            | the page canvas, behind everything                                          |
| `--sa-color-bg-surface`        | a card, a section, an input — the paper you write on                        |
| `--sa-color-bg-surface-raised` | a strip that should read as _above_ the surface: a table head, a footer bar |
| `--sa-color-bg-sunken`         | a well _below_ the surface: a hovered row, a code block                     |
| `--sa-color-bg-overlay`        | the scrim behind a dialog                                                   |
| `--sa-color-fg-heading`        | titles, and any number that is the point of its tile                        |
| `--sa-color-fg-body`           | ordinary prose and table cells                                              |
| `--sa-color-fg-secondary`      | figures and meta lines that must stay readable while staying calm           |
| `--sa-color-fg-muted`          | captions, labels, subtitles                                                 |
| `--sa-color-fg-subtle`         | hints and placeholders — the quietest text that is still information        |
| `--sa-color-fg-disabled`       | text that is _not_ information: a dash, a separator, a disabled control     |
| `--sa-color-fg-on-accent`      | text lying on a solid coloured surface                                      |
| `--sa-color-border`            | the default line                                                            |
| `--sa-color-border-soft`       | a divider inside a block, quieter than its outline                          |
| `--sa-color-border-strong`     | a control's own outline — a button, a stepper                               |
| `--sa-color-border-focus`      | the focused control                                                         |

**`-muted` or `-subtle`?** Ask whether the reader needs the words. A column
label is muted: they will read it once. A placeholder is subtle: they read it
only if they are lost. If they must never read it — an em dash between two
values — it is `-disabled`.

### The accent

`--sa-color-accent` is your application's brand. It reads Quasar's
`--q-primary`, which comes from your `$primary`, so there is nothing to
configure: set it once and the hero, the buttons, the focus ring, the tinted
surfaces, Quasar's own components and the tenant-facing pages all follow.

| Role                               | For                                                                  |
| ---------------------------------- | -------------------------------------------------------------------- |
| `--sa-color-accent`                | the brand itself — a selected border, an active icon                 |
| `--sa-color-accent-strong`         | the same thing with more weight: a hover fill, accent text on a tint |
| `--sa-color-accent-surface`        | an 8 % wash — the hero's tint                                        |
| `--sa-color-accent-surface-soft`   | a 4 % wash, for the second stop of a gradient                        |
| `--sa-color-accent-surface-strong` | an opaque tint — a chip, a selected table header                     |
| `--sa-color-accent-border`         | the line that closes an accent surface                               |

### Tones

Five, each with the same six slots, so knowing one is knowing all five:

`positive` · `warning` · `negative` · `info` · `scheduled`

| Slot                               | For                                              |
| ---------------------------------- | ------------------------------------------------ |
| `--sa-color-<tone>`                | the solid graphic colour — an icon, a bar, a dot |
| `--sa-color-<tone>-strong`         | the brighter variant, for a selected outline     |
| `--sa-color-<tone>-fg`             | text **on** the tinted surface, contrast-checked |
| `--sa-color-<tone>-surface`        | the quiet tint — a banner across a section       |
| `--sa-color-<tone>-surface-strong` | the loud tint — a chip, a pill, one cell         |
| `--sa-color-<tone>-border`         | the line that closes either surface              |

`scheduled` is a tone rather than a reused blue: a version that is planned but
not live is neither a warning nor an achievement. Six surfaces had each picked
their own colour to say it before this existed.

### Catalogue entities

`--sa-color-feature` (violet), `--sa-color-quota` (sky) and `--sa-color-bundle`
(amber) say **what a row is**, not how it is doing. The plan editor, the matrix,
the review and the discovery page all render the same dots; without shared roles
the same colour meant two things on two screens.

### Inverse chrome

The header, the drawer and the login backdrop are dark **by design**, in both
themes. They use `--sa-color-inverse-*` — `-bg`, `-surface`, `-surface-soft`,
`-fg`, `-fg-muted`, `-fg-subtle`, `-accent`, `-accent-strong`, `-accent-fg`,
`-accent-surface`, `-accent-surface-strong`, `-border`, `-border-strong` — and
those are declared identically in both themes on purpose. A role that flipped
would turn the drawer's labels black on black the moment somebody enabled dark
mode. That defect was in the login page's backdrop gradient and is why the
family exists.

---

## Dark mode

Nothing in a page knows a dark theme exists. Use roles and it follows.

Two ways in, and both mean _the application decided_:

| Trigger                              | Who decided                                        |
| ------------------------------------ | -------------------------------------------------- |
| `[data-sa-theme='dark']` on `<html>` | the app, e.g. `handle.theme.scheme.value = 'dark'` |
| `body.body--dark`                    | Quasar — `$q.dark.set(true)`                       |

**The stylesheet does not answer `prefers-color-scheme`, on purpose.** It paints
the platform's surfaces; Quasar paints its own cards, dialogs and steppers, and
Quasar follows only `body--dark`. A media query in the stylesheet moves one of
them and leaves the other — measured on an embedded page with a dark OS, that
was a white card carrying near-white text.

Following the OS therefore lives one level up, where both halves move together:
`scheme: 'system'` is the default and subscribes to `prefers-color-scheme` live.
`createSuperAdminApp` wires it, so the admin shell follows the OS out of the
box. An app that embeds `pages-tenant/*` and wants the same says so:

```ts
import { createSaTheme } from '@saasicat/ui-vue';
import { bindSaThemeToDocument } from '@saasicat/ui-vue/quasar';

bindSaThemeToDocument(createSaTheme());
```

```ts
const handle = createSuperAdminApp({ /* … */, theme: { scheme: 'system' } });
handle.theme.scheme.value = 'dark'; // 'light' | 'dark' | 'system'
```

Inside a component, `useSaTheme()` gives you `scheme` (what was picked) and
`resolved` (what that means right now). `createSuperAdminApp` mirrors the
resolved value onto both `data-sa-theme` and Quasar's `Dark`, because either one
alone leaves half the screen behind.

If you ever tear a shell down while the page survives — hot reload, a
micro-frontend, two shells in one document — call `handle.dispose()`. It ends
the `prefers-color-scheme` subscription and the bridge. Skip it and the old
bridge keeps writing `data-sa-theme` and `Dark` onto the one document at the
next OS theme change, and can overrule the scheme the new shell was given.

**What does not flip:** the brand accent, and the inverse chrome. A green product
stays green in the dark, and a surface that is dark on purpose does not become
light. Everything else does.

### Overriding a role

A role has **two** values, so an override has two. Write them on the same
selectors the theme uses, from a stylesheet that loads after it:

```css
:root {
    --sa-color-negative: #a3122b;
}
[data-sa-theme='dark'],
body.body--dark {
    --sa-color-negative: #ff6b81;
}
```

**Overriding on `:root` alone does not work, and it fails three different ways** —
measured, and pinned by a test so this stays true:

|                           | `:root` only                            | both selectors  |
| ------------------------- | --------------------------------------- | --------------- |
| light                     | your value                              | your value      |
| dark, via `data-sa-theme` | your value — the **dark theme** is lost | your dark value |
| dark, via Quasar          | **your override is lost**               | your dark value |

The last row is the one that bites. Quasar's trigger declares the roles on
`<body>`, and a value declared on a closer ancestor beats an inherited one no
matter what the specificity or the order says — so everything inside the body
inherits the platform's value and never sees yours.

For the brand you do not need any of this: set `$primary` and the accent
follows.

**One exception, and it is the one to know about.** `--sa-color-fg-on-accent` is
white, and that is an assumption rather than a derivation: CSS cannot branch on
a colour's luminance, so nothing notices when `$primary` is a light amber and
white on it reads 2.15:1. If your brand is light, override this role — the
buttons, active tabs and filled controls all read it.

---

## The scales

### Space — 4 px base, twelve steps

`--sa-space-0` 0 · `-1` 2 · `-2` 4 · `-3` 8 · `-4` 12 · `-5` 16 · `-6` 20 ·
`-7` 24 · `-8` 32 · `-9` 40 · `-10` 48 · `-11` 64

Named: `--sa-gap-inline` (8) · `--sa-gap-stack` (16) · `--sa-pad-page` (20) ·
`--sa-pad-section` (20) · `--sa-pad-control` (8) · `--sa-pad-cell` (12).

### Type — nine steps

| Token           | Size | For                                 |
| --------------- | ---- | ----------------------------------- |
| `--sa-text-2xs` | 10px | pill, table meta                    |
| `--sa-text-xs`  | 11px | caption, KPI sub-line               |
| `--sa-text-sm`  | 12px | table body, hints                   |
| `--sa-text-md`  | 13px | body copy — the default             |
| `--sa-text-lg`  | 15px | section title (h2), card title      |
| `--sa-text-xl`  | 18px | page title (h1)                     |
| `--sa-text-2xl` | 22px | KPI value                           |
| `--sa-text-3xl` | 28px | login, setup                        |
| `--sa-text-4xl` | 32px | a price total, a marketing headline |

Each step has a matching `--sa-leading-*`, plus `--sa-weight-{regular,medium,semibold,bold}`
and `--sa-tracking-{tight,normal,wide,wider}`. No `font-size` in the package
names a number, and the layer test keeps it that way.

### Radius

`hero` 16 → `section` 14 → `card` 12 → `head`/`tile` 10 → `field` 8 →
`control` 7, plus `--sa-radius-pill` (999px). The order is the nesting: a
section is a bigger block than the cards inside it.

### Shadow

`--sa-shadow-0` … `--sa-shadow-4`, and `--sa-shadow-focus`. Semantically:
`--sa-elevation-tile` · `-card` · `-menu` · `-dialog`. They are theme-aware —
the ink and the alphas both change, because a slate shadow at 6 % is invisible
on a slate surface.

### Stacking

`--sa-z-base` 0 · `-sticky` 100 · `-drawer` 3000 · `-overlay` 5900 ·
`-dialog` 6000 · `-toast` 9500 — Quasar's own layers. Never invent one above
them: a platform overlay outranking Quasar's dialog covers the dialog your page
opened from it.

### Breakpoints

`xs` 0 · `sm` 600 · `md` 1024 · `lg` 1440 · `xl` 1920, matching Quasar.

These are the one scale that cannot be a custom property — CSS does not
substitute variables inside a `@media` condition. In an SCSS block:

```scss
@use '@saasicat/ui-vue/theme/breakpoints' as bp;
@media (max-width: bp.$sm-max) { … }
```

In plain CSS, write the number; the five values are an allow-list.

---

## Writing CSS in a page

**When?** Only for the layout of your own composition — a grid template, a flex
direction, a gap. Anything that is colour, radius, shadow, type size or surface
is a token or a primitive; if no primitive exists yet, that is the thing to add.

**Scoped or unscoped?** `scoped`, always. To reach a child, put that child in
your page's own folder and use `:deep()`. If `:deep()` cannot reach it, it
belongs in the shared layer with a prop.

**Naming.** One BEM block per page, `sa-<page>`, appearing in that page and its
own folder and nowhere else.

---

## Accessibility baseline

- **One `<h1>` per page.** `AdminHero` renders it; `level="2"` for a block
  inside the body.
- **Every section is labelled.** `AdminSection` wires `aria-labelledby` from its
  title via `useId()`. A section without a title gets no landmark rather than an
  unnamed one.
- **Focus is visible.** `--sa-shadow-focus` — never remove an outline without
  replacing it.
- **Text contrast ≥ 3:1**, in **both** themes, checked on all nineteen standard
  pages by `tests-e2e/theme-contrast.spec.ts`. That is a floor, not a target:
  it is the line below which text is not hard to read but gone. Where a page
  cannot meet it, the exception is named in that file with its reason, and a
  test fails if the exception stops describing anything.
- **Icons are not text.** An icon carrying meaning needs a label beside it or an
  `aria-label`; `AdminRefreshBtn` takes one.

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
own `<q-table>` — both are enforced by `tests/component/admin-page-shell.test.ts`,
which reads the source of every page and fails on a violation.

### Rows that open

A list whose rows expand is `AdminAccordion`, one per row:

```vue
<AdminAccordion
    v-for="row in rows"
    :key="row.id"
    :open="openId === row.id"
    @update:open="openId = openId === row.id ? null : row.id"
>
    <template #mark><q-icon name="inventory_2" size="18px" /></template>
    <template #header><!-- the row: keys, chips, whatever it carries --></template>
    <template #header-actions><!-- controls that must NOT toggle it --></template>
    <!-- the body, rendered only while open -->
</AdminAccordion>
```

Three things about it are decisions rather than details, and each was a defect
somewhere before it was a rule:

- **The trigger is a `<button>`.** Four of the eight surfaces this replaced were
  a `<div>` with a click handler — no keyboard, no `tabindex`, and nothing an
  assistive technology could announce as a control. `aria-expanded` did not
  appear anywhere in the package.
- **`header-actions` renders outside the trigger.** A control inside it would
  fire the toggle on the way past, and interactive content nested in a
  `<button>` is not valid HTML. The discovery cards relied on an `@click.stop`
  for this; structure does not have to be remembered.
- **The page owns `open`.** Five of the eight take it from outside, and the
  bundle list ties opening one row to closing another and loading that bundle's
  versions. A component that flipped its own boolean would fight that, so it
  emits and does not decide.
- **`#mark` gives the glyph, not the badge.** The row icon had been drawn three
  ways — a tinted 34px square, a bare 22px glyph, and a bare 20px glyph coloured
  through a Quasar _palette_ prop, which reaches past the role layer entirely —
  so the same kind of row did not look the same on two pages. `markTone` is for
  the one row whose state the badge itself should report; it moves the colour
  and nothing else, which is what keeps it the same badge.

`tests/component/admin-page-shell.test.ts` keeps the package at one disclosure:
it reads every `.vue` under `src` for a click that flips a value the same
template renders a body on, and for a view that declares itself a disclosure
control with a hand-written `aria-expanded` or a native `<details>`.

Three surfaces are deliberately not `AdminAccordion`, and each says why in its
own source rather than in a list here. A note names the finding it excuses —
``sa-disclosure-exempt(writes `aria-expanded`): …`` — so it covers that one
surface and nothing else. A second, unexplained disclosure in the same file is
still a failure, and so is a note left behind after its surface was migrated:

- **`marketing-catalog/MarketingCatalogAdmin.vue`** — its rows are
  `display: contents` cells of a six-column grid and the open editor spans
  `1 / -1`, so a self-contained wrapper would stop the columns lining up. The
  header is also six cells carrying checkboxes and text inputs, which cannot sit
  inside a `<button>`.
- **`PackageSnapshotPanel.vue`** — it lives in `@saasicat/ui-vue-tenant` now,
  a different package for a different audience, and a raw-JSON toggle at the
  foot of a `q-card` is not a row in a list.
- **`auth/SuperAdminSetupWizard.vue`** — a native `<details>`, already
  keyboard-operable and already announced. The screen is a centred first-run
  card outside `AdminLayout`, and the body it opens is one line of text.

The first two still take the half of the recipe that is not layout: a `<button>`
that reports `aria-expanded` and names the element it controls. `role="region"`
is the part they leave — the accordion's body is named by a trigger carrying the
row's title, and a bare chevron makes a poor name for a landmark.

**A screen that cannot use `AdminPage`** — a login, a first-run wizard, a
fail-closed error page, anything full-viewport with a frame of its own — still
puts `.sa-page` on its root, next to its own root class. That class is not
decoration: `.sa-page` and `.sa-portal` (which `createSuperAdminApp` sets on
every teleported node) are the only two prefixes through which the theme
corrects Quasar's own DOM, so a screen carrying neither gets Quasar's outlined
field, its 4px radii and, in dark mode, its neutral grey card — with nothing to
announce it. The screen's own root class is more specific than `.sa-page`, so
its frame still wins; only the reach is shared.
`tests/theme-reaches-every-page.test.js` holds every page to it.

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

1. The page could not load → `<AdminErrorBanner :error="list.error.value" :retry="list.reload" />`
   under the hero; the body stays in its loading or empty state. The banner renders nothing while
   `error` is null, so it is bound unconditionally and never needs a `v-if`.
2. A mutation failed while a dialog is open → the dialog says so. `AdminFormDialog` and
   `AdminConfirmDialog` do this by themselves; a hand-built dialog puts an `AdminErrorBanner`
   above its actions.
3. A mutation failed and there is nothing on screen to attach it to → a toast,
   raised through the `UiNotify` port.

Never a toast for a failed load. Never a toast for something already visible. And never a
hand-written error box: the five pages that had one worded the same axios rejection five
different ways.

**Which overlay?**
Four answers, and the first one that fits wins:

1. A yes/no question, possibly with one value back, raised from script →
   the `UiConfirm` port (`useSuperAdminConfirm()`). No markup, no `v-model`, no component.
2. That question, but it carries markup, a typed confirmation, or a body longer than a
   sentence → `AdminConfirmDialog`.
3. A form the operator fills in and submits → `AdminFormDialog`. It owns the whole
   lifecycle: disabled while pending, the failure shown without closing, closed and
   announced on success.
4. Anything else that is a dialog → `AdminDialog`, and fill its `footer` slot.

A bare `<q-dialog>` in a page is none of the above and is a gap in this list — say so
rather than working around it.

**A KPI, or a section?**
A KPI is _one_ scalar with a trend or a link. Three or more related scalars with
dimensions are a table in a section. Never more than five KPIs in a row.

---

## The primitives

Everything on this list is in `@saasicat/ui-vue`, imported from `@saasicat/ui-vue/ui/…`.
Everything not on it comes from Quasar directly and is styled by the theme — buttons,
inputs, tabs, selects and badges are Quasar components, and wrapping one in an `Admin*`
of your own puts a second answer next to the first.

| Component                       | Use it for                                                               |
| ------------------------------- | ------------------------------------------------------------------------ |
| `AdminPage`                     | The page frame. One per route.                                           |
| `AdminHero`                     | The identity block: the one `<h1>`, and page-level actions.              |
| `AdminBody`                     | The content region, and the owner of the loading and empty states.       |
| `AdminSection`                  | One labelled block of a page. Carries the surface.                       |
| `AdminFilters`                  | The input row that narrows the list in its section.                      |
| `AdminToolbar`                  | The action row above a table that is not the hero.                       |
| `AdminStatistics` / `AdminKpi`  | Up to five scalars across the top.                                       |
| `AdminTable`                    | Every tabular list. No page writes its own `<q-table>`.                  |
| `AdminPaginator`                | Paging under a table.                                                    |
| `AdminRowActions`               | The per-row controls in a table's `row-actions` slot.                    |
| `AdminRefreshBtn`               | Reload, with its pending state.                                          |
| `AdminAccordion`                | A row that opens.                                                        |
| `AdminBanner`                   | An inline notice, in one of four tones.                                  |
| `AdminErrorBanner`              | The failure case of that — one prop, renders nothing when there is none. |
| `AdminEmptyState`               | What a list shows when it has nothing to show.                           |
| `AdminStatusPill`               | A status, as a word plus a tone. Never a colour on its own.              |
| `AdminKvBlock`                  | A key-value block.                                                       |
| `AdminDialog`                   | The chrome under every dialog.                                           |
| `AdminFormDialog`               | A dialog whose point is a write. Owns the submit lifecycle.              |
| `AdminConfirmDialog`            | A dialog that asks before something irreversible.                        |
| `AdminField` / `AdminFieldGrid` | A labelled control, and the grid it sits in.                             |

Two of them take a function prop, and they are the only two in the package: `AdminFormDialog`
takes `submit` and `AdminConfirmDialog` takes `confirm`. Everything a page needs from the
platform arrives through the resource ports instead — a page that finds itself passing
`loadX` down is passing its data layer through its view.

**Before adding a component of your own**, check in this order: does a primitive already do
it, can one be extended without turning it into a universal component, is this a documented
variant or prop, or is it genuinely a separate concept? The third answer is the most common
and the least often taken.

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

To change it **at runtime**, write to the root:

```ts
setCssVar('primary', value, document.documentElement);
```

The third argument matters. Quasar's `setCssVar` defaults to `<body>`, and the
accent role is computed on `:root` — a custom property resolves where it is
declared, so a value written one level below is invisible to it. Quasar's own
components would recolour and the admin would not.

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

**A solid tone cannot carry text.** Every rung of `--sa-color-<tone>` and
`-strong` is picked to be legible _as_ a colour against its own theme's surface,
which puts it in the middle of the lightness range — and nothing reads on the
middle. White on `--sa-color-positive-strong` (green-500 in **both** themes)
measures **2.54:1**, and near-black on it is no better in the dark theme, where
that same rung has to sit on slate. There is no `<tone>-on-solid` role because
there is no colour that could fill it. A chip with a label is `-surface-strong`
plus `-fg`, always. If you want the solid look, what you actually want is the
tint with a heavier glyph.

That the number is identical in both themes is the second half of the lesson:
this defect was not a dark-mode regression, and no amount of dark-mode review
would have surfaced it.

### Catalogue entities

`--sa-color-feature` (violet), `--sa-color-quota` (sky) and `--sa-color-bundle`
(amber) say **what a row is**, not how it is doing. The plan editor, the matrix,
the review and the discovery page all render the same dots; without shared roles
the same colour meant two things on two screens.

Each has the same three slots a tone has — the colour, a `-surface` tint, and an
`-fg` that is readable on that tint. `feature` had all three from the start and
the other two did not, which is why the version diff wrote `#0ea5e9` and
`#f59e0b` straight into its template: **there was no role to point at, so the
component reached past the layers for a primitive.** A missing rung in a family
does not stay missing; it becomes a literal somewhere.

### Identity — colours that only need to differ

`--sa-color-identity-1` … `-6`, plus `--sa-color-identity-neutral`.

Reach for these when a colour's only job is to tell one row from the next and it
means nothing beyond that: a plan's mark, a promotion badge, a capability kind.
Reach for the tones or the catalogue entities above when the colour carries
meaning. A reader should never have to work out which of the two a colour is
doing.

```ts
import { IDENTITY_ACCENTS, identityAccentFor, identityChipStyle } from '@saasicat/ui-vue/client';

// The three-part chip: a wash, the accent as text, a firmer edge.
const style = identityChipStyle(identityAccentFor(plan.planKey, props.planAccents, index));
```

Two rules come with them, and both are the reason the ramp exists at all:

- **Tint with `color-mix()`, never by string surgery.** `accent + '15'` needs a
  six-digit hex; it produces nothing at all for an `rgb()`, for a named colour
  and for a `var()`. That is why five components carried their own hex ramp and
  none of them could follow the theme. `identityChipStyle()` does the mixing,
  and an audit category fails the build on a reappearing `+ '15'`.
- **A colour you _store_ is a value, not a token.** Use
  `IDENTITY_ACCENT_VALUES` — the same ramp as concrete colours — anywhere the
  colour leaves the browser: a picker whose choice is persisted, a payload
  field, an export. `var(--sa-color-identity-1)` is 26 characters and means
  nothing outside a document that has the stylesheet; the promotions endpoint
  caps its `color` at 16, so pointing its swatches at the token form broke every
  create. A test binds the two halves, so they cannot drift apart.
- **Each rung is picked to be readable as text**, in its own theme, on that
  theme's card surface — not just distinguishable as a dot. The plan mark used
  violet-600 and measured 2.96:1 in dark; it was carried as a named contrast
  exception for a release because there was no role to point it at.

A consumer's own colours still win: `planAccents` takes any CSS colour, and
everything here mixes rather than concatenates, so a hex works exactly as well
as a role.

### Surfaces that do not follow the theme

The header, the drawer and the login backdrop are dark **by design**, in both
themes. They use `--sa-color-inverse-*` — `-bg`, `-surface`, `-surface-soft`,
`-fg`, `-fg-muted`, `-fg-subtle`, `-accent`, `-accent-strong`, `-accent-fg`,
`-accent-surface`, `-accent-surface-strong`, `-border`, `-border-strong` — and
those are declared identically in both themes on purpose. A role that flipped
would turn the drawer's labels black on black the moment somebody enabled dark
mode. That defect was in the login page's backdrop gradient and is why the
family exists.

Two more surfaces are loud rather than dark, for the same reason and with the
same rule: the production banner (`--sa-color-inverse-danger`) and the plan-diff
hero (`--sa-color-inverse-notice`). Their text is white and stays white, so the
surface underneath has to stay dark enough for it — and the `negative` and
`warning` roles deliberately lighten in dark mode, because they are meant for
text ON dark surfaces rather than beneath it.

**The rule, in one line:** if a surface is painted the same in both themes, every
role on it must be one that does not flip. A test enforces it, deriving "flips"
by comparing the two theme files rather than from a list.

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
box. An app that embeds `@saasicat/ui-vue-tenant` and wants the same says so:

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

### The one rule behind the next two sections

**A custom property is resolved where it is _declared_, not where it is read.**

That sentence is the single most expensive thing to not know about this theme.
It caused four separate defects during the dark-mode work, each looking like a
different bug:

| What was written                                      | What happened                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `setCssVar('primary', c)` — Quasar's default          | written to `<body>`; the accent is computed on `:root`, one level **above**, and never saw it    |
| a consumer override on `:root` alone                  | survives the attribute trigger and is **lost** under Quasar's, which redeclares on `<body>`      |
| `--sa-heading: var(--sa-color-fg-heading)` on `:root` | the alias froze the **light** value; descendants inherit the finished result, not the expression |
| a `:root` override meant to reach the dark roles      | never applies — the dark roles live under `body.body--dark`, i.e. **below** it                   |

The same mechanic also carries: because the dark roles are declared on the body,
a single `body { background: var(--sa-color-bg-app) }` covers both themes. Know
the rule and you write one line; miss it and you write two, one of them wrong.

**In practice:** declare a token wherever the thing that reads it is computed,
and when a role has two values, write both — on the theme's own selectors.

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
and `--sa-tracking-{tight,normal,wide,wider}`.

No `font-size:` declaration in the package names a number — in a `<style>` block
**or** in an inline `style="…"` attribute — and `theme-layer-discipline.test.js`
fails on one that does.

That sentence used to be printed here without the middle clause, while four
literal sizes sat in two templates: the audit pulled a `style` attribute out of
the AST and then read it for colour only, so the metric answered `0` to a
question it had never asked, and this guide repeated the `0`.

**It is a claim about `font-size:`, and about nothing else.** The other three
families still hold literals, and so does the `font:` shorthand — which sets a
weight, a size and a leading at once and is invisible to all three of the
patterns that read them by name. `pnpm tokens` counts each of them:
`font-weight literals`, `line-height literals`, `letter-spacing literals` and
`font: shorthand literals`, the last of which still hides the package's final
literal size. The budget test pins every one of those numbers at today's value,
so they can fall and not rise — reach for the token rather than adding to them.
A `600` in a rule says nothing about why that text is heavier than the line
above it; `--sa-weight-semibold` does.

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

In plain CSS, write the number — and write the `max-width` bounds as Quasar
writes them, with the 0.02px step back that stops a `max-width` and the next
`min-width` both matching at an integer viewport:

`599.98` · `1023.98` · `1439.98` · `1919.98`

The audit fails on any other value. It counts _which_ rather than _how many_:
using three of the five bands is not debt, inventing a sixth is. The package
had six of its own (540, 600, 980, 1100, 1180, 1280), so a component reflowed at
980px inside an app whose grid moves at 1024px — a 44px band where the two
disagreed.

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

**A colour in a template is a colour.** `style="background: #ef4444"` and
`:style="{ background: p.color ?? '#94a3b8' }"` are paint, and an attribute
reads `var(--sa-color-…)` exactly as a rule does. The audit counts them —
`colours in templates`, floor 0 — because for a long time it did not: its
headline read `hard-coded hex colours 0 in 0 files` while twelve of them sat in
six templates, and a zero that is wrong ends the search. A colour that is
**stored** rather than painted is the one exception, and it has its own answer
in `IDENTITY_ACCENT_VALUES` above.

**And a size in a template is a size.** The same attribute, the same argument,
one category later: `style="font-size: 22px"` and `style="margin-top: 6px"` are
the debt the rules they replace would have been. The audit read that attribute
with one eye for a long time — it found the colours in it and nothing else — so
`distinct font sizes` printed `0` with four of them in two templates. An
attribute reads `var(--sa-text-…)` and `var(--sa-space-…)` exactly as a rule
does, and both the audit and the layer test now read `<style>` blocks and
`style` attributes through the same parser.

**A palette name is a colour too.** `class="text-grey-7"` holds no hex, no
colour function and no keyword, which is why no pattern here ever saw one — but
it resolves to Quasar's scale, one layer **below** the roles. It therefore keeps
its grey when the dark theme moves the surface under it. `pnpm tokens` counts
these under `Quasar colour classes`; the answer is the role that says what the
text is (`--sa-color-fg-muted`, `--sa-color-warning-surface`).

`color="grey-7"` is the same decision written as a prop — Quasar renders it as
exactly that class — and it is counted separately, under `Quasar palette props`,
because the two come off differently: a class with a CSS rule, a prop with a
component's API. A brand or status name there (`color="primary"`,
`color="negative"`) resolves through `--q-*`, which the theme does read; an
absolute hue does not, and is the half to give a role first.

**Both halves of a pair in the same rule.** A `color` whose `background` is
declared somewhere else is a pair no check can read — and **all five** contrast
defects found in this package were that shape, in three variations: the
background one rule further down (`.pd-diff-icon` held the colour, its variants
held the background), the background on an ancestor (a `<em>` keeping its own
colour while `:hover` moved the surface under it), and the background in a
template attribute (`style="background: #f59e0b"` against a colour declared in
CSS). Splitting geometry from paint is what let white-on-green-500 sit in the
diff panel for the component's whole life.

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
  pages by `tests/e2e/theme-contrast.spec.ts`. That is a floor, not a target:
  it is the line below which text is not hard to read but gone. Where a page
  cannot meet it, the exception is named in that file with its reason, and a
  test fails if the exception stops describing anything.
- **Icons are not text.** An icon carrying meaning needs a label beside it or an
  `aria-label`; `AdminRefreshBtn` takes one.

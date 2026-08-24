---
'@saasicat/ui-vue': minor
---

Every form control and every action button in the admin UI is now a Quasar
component: `q-input`, `q-select`, `q-checkbox`, `q-toggle`, `q-btn`.

**Why it matters to you.** The package had eight independent `input`
implementations and six `button` families — 784 lines of CSS reproducing what
Quasar and the theme already give you. A field built that way misses the theme's
corrections (dark-mode surface, focus ring, the fix for a field inside a
teleported dialog) and every Quasar-level setting you make: an app that themed
`$primary` or `q-field` reached the filter rows and missed the editors. Two
inputs on one page reacted differently to the same setting, and nothing in the
markup said which was which.

**What changed for you.** If you styled these by selector — `.pc-input`,
`.bve-btn`, `.bcp-btn`, `.pcd-btn`, `.sa-btn` and their kin — those classes are
gone; style `q-input`/`q-btn`, or the design tokens, instead. Spacing shifts by
a rung or two in places and the paginator's buttons are 4.5px taller, which is
Quasar's hit area.

Twenty-one native `<button>`s remain on purpose — segmented cards, chips with a
colour mark, a bar in a chart, a disclosure trigger — and each says at the
element why. `saasicat/no-hand-built-controls` refuses the rest.

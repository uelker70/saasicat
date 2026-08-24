---
'@saasicat/ui-vue': minor
---

The marketing catalog's plan list is reordered by dragging, and every disclosure
in the admin UI opens the way the others do.

**Order is a gesture now, not a number.** The "Priority" column held a number
field per row, and the list sorted by it — so moving a plan up meant working out
which number would put it there, in a list that re-sorted under the cursor while
you typed. A drag handle sits on the left of each row instead: drag it, or focus
it and press ↑/↓, and the platform computes the priorities that produce that
order. Existing values are kept and only reassigned, so the gaps an operator
chose (100 / 50 / 10) survive; rows that keep their value are not written. Plans
that start out tied at `0` are pulled apart on the first move, because equal
priorities cannot carry an order. A plan with no live version has no handle: it
cannot hold a marketing projection, so there is no priority to write.

**The whole row opens the editor.** Clicking anywhere in a row that is not one of
its fields opens the teaser and top-features editor; before, only a chevron at
the far right did. The chevron is gone, and the plan cell is still the element a
keyboard tabs to and a screen reader hears as the disclosure. A row's status —
`live`, `hidden`, `Featured` — now sits beside the plan name rather than in a
column of its own, which is where the bundle list already put it.

**Accordions animate and have lost their chevron.** `AdminAccordion`'s body
slides open and shut through `q-slide-transition` instead of appearing, so a list
where several rows open no longer jumps; the badge deepens to report which row is
open. This affects every surface built on it — discovery, bundles, promotions,
the promo-code form, the setup wizard.

New in the package: `useRowReorder` (from `@saasicat/ui-vue/vue`) for the pointer
half of a drag, `reorderedPriorities` (from `@saasicat/ui-vue/client`) for the
arithmetic, and a `.sa-sr-only` utility in the theme.

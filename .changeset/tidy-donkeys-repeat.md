---
'@saasicat/ui-vue': minor
---

Move the last hand-rolled disclosures onto `AdminAccordion`, and guard the rule

`AdminAccordion` shipped with three of eight disclosure surfaces migrated. Two
of the remaining five move here — the promotions list in the marketing catalog,
whose row was a `<div>` with a click handler, and the advanced section of the
promo-code form, whose state lived in an icon swap and nowhere else. Both are
now a real button that reports `aria-expanded` and names the body it controls.

The promotions list also loses a defect the two idioms hid between them: its row
and its editor styled themselves as one joined block while the list's `6px` gap
sat between them.

Three surfaces stay out, each with the reason written in its own source: the
marketing catalog's admin rows (`display: contents` cells in a six-column grid,
with a `grid-column: 1 / -1` editor, and a header full of inputs that cannot go
inside a `<button>`), the tenant package snapshot (outside the admin, a raw-JSON
toggle rather than a row), and the first-run wizard's native `<details>`. The
first two gain `aria-expanded` and `aria-controls` where they are.

A twentieth rule in `admin-page-shell.test.ts` now fails the build on a click
that flips a value the same template renders a body on, and on a view that
declares itself a disclosure with a hand-written `aria-expanded` or a
`<details>`, unless the file says why. The exemption notes are also the rule's
fixtures: a note left behind after its surface was migrated fails too.

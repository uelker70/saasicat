---
title: Accessibility
---

Accessibility is part of what SaaSiCat delivers, not a pass over it afterwards. The requirements
below are the ones a person actually notices: whether they can read the text, whether they can
reach the control, and whether the information survives being seen without colour. They apply in
both the light and the dark theme, because a screen that only works in one of them works for half
the people using it.

### SC-A11Y-001 — Text is legible in both themes

🟢 Contrast is measured on every shipped screen, in light and in dark. The floor is not a target: it
is the line below which text is not hard to read but gone.

_Source:_ `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/theme-bootstrap.test.ts`
    - Quasar
    - an explicit scheme still outranks what Quasar was set to
    - Quasar
    - the machine still decides when Quasar says
    - Quasar
    - with no dark configuration at all, the theme is left on system
    - Quasar
    - the two directions do not chase each other
    - a
    - Quasar
    - a hard pick that agrees with the machine is still a pick
    - dispose() stops the bridge writing to the document
- `packages/ui-vue/tests/text-shape.test.js`
    - accepts what the old pattern accepted
    - rejects what the old pattern rejected, and the shapes it got wrong
    - finishes on the input the pattern backtracked on
    - strips a run of one character at either end and nothing inside
    - finishes on a long run
- `packages/ui-vue/tests/theme-role-contrast.test.js`
    - the sweep found rules and can resolve the palette
    - gradient backgrounds are read, not skipped
    - nothing falls under ${CONTRAST_FLOOR}:1 in the ${themeName} theme
    - every pairing the ${themeName} sweep leaves unjudged says why
    - the helper no longer hands back the bare accent as text
    - the resolver reaches real numbers for both input shapes
    - every colour the product itself stores clears ${CONTRAST_FLOOR}:1 in ${themeName}
    - no colour in sRGB falls under ${CONTRAST_FLOOR}:1 in ${themeName}
- `packages/ui-vue/tests/theme-token-parity.test.js`
    - the files were actually read
    - every light role has a dark counterpart, and the reverse
    - the theme fires only on a signal the application sent
    - no role is declared twice within one theme
- `tests/a-role-that-is-read-is-defined.test.js`
    - both sides of the comparison were actually read
    - the definitions reach the scale, not only the colours
    - the reads reach the two files the defect shipped in
    - no role is read that the theme leaves undefined
    - the rule is not vacuous: an undefined role is reported, with its line
    - and a role the theme defines is not reported
    - a fallback answers for the role it stands in for
    - a nested read is a read of its own
    - a role named in a comment is not a read
    - a comment above a read does not move its line
    - the import graph is followed, not guessed
- `tests/filled-status-carries-white-text.test.js`
    - the base layer declares some
    - each resolves to a literal colour rather than another variable
    - white on each clears the floor
    - both themes declare them, with the same value
    - each theme hands the same four to Quasar, in its own block

<!-- END proof -->

### SC-A11Y-002 — Meaningful visuals stand out from what is next to them

🟢 Icons, control edges, status marks and chart elements are distinguishable from their surroundings
at no less than 3:1, and body text at no less than 4.5:1.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/theme-role-contrast.test.js`
    - the sweep found rules and can resolve the palette
    - gradient backgrounds are read, not skipped
    - nothing falls under ${CONTRAST_FLOOR}:1 in the ${themeName} theme
    - every pairing the ${themeName} sweep leaves unjudged says why
    - the helper no longer hands back the bare accent as text
    - the resolver reaches real numbers for both input shapes
    - every colour the product itself stores clears ${CONTRAST_FLOOR}:1 in ${themeName}
    - no colour in sRGB falls under ${CONTRAST_FLOOR}:1 in ${themeName}
- `tests/filled-status-carries-white-text.test.js`
    - the base layer declares some
    - each resolves to a literal colour rather than another variable
    - white on each clears the floor
    - both themes declare them, with the same value
    - each theme hands the same four to Quasar, in its own block

<!-- END proof -->

### SC-A11Y-003 — A colour used as a fill is not the same colour used as text

🟢 A status colour tuned to be read against the page goes lighter in the dark theme; the same value
used as a background with white text on it drops to 1.67:1. Each tone therefore has both roles,
and text on a filled surface stays legible in both themes.

_Source:_ release 1.0.0-rc.6

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/design-token-budget.test.js`
    - the audit reaches the source tree
    - the inline-style sweep reads a fixture it cannot miss
    - a CSS-wide keyword is not a typographic value
    - a palette prop counts on a Quasar component and nowhere else
    - ${metric} does not grow (floor ${floor} — ${why})
    - ${metric} baseline has not overshot its floor

<!-- END proof -->

### SC-A11Y-004 — Every control can be reached and operated from the keyboard

🟢 A row that opens is a button, not an area that happens to respond to a click. Four of the eight
expandable surfaces this replaced could not be reached or announced at all, and a search for the
attribute that announces them returned nothing.

_Source:_ #133 · `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/disclosures-open-what-they-say.test.ts`
    - the row is a button that says whether it is open
    - clicking one row opens that row, and only that one
    - clicking the open row closes it again
    - the timeline bar that opens the same row is a control too
    - the toggle is a button that says whether it is open
    - the backend-only fields appear once it is open
    - the toggle asks its owner rather than deciding
    - an edit in the open editor reaches the update handler
    - the plan cell is the keyboard path, and says what it controls
    - a click on a cell that holds no control opens the row
    - a click on a field in the row does not
    - the handle moves the row with the arrow keys
    - the arrow keys stop at the ends of the list
    - a drag from the first row to the second reports that move
    - a drag downwards lands where the pointer is, not one row further
    - a twitch inside the dragged row is not a move
    - a drag upwards lands where the pointer is
    - a drag released where it started reports nothing
    - a row that cannot be written is not part of the order
    - a row without a live version has no handle
    - a focusable ancestor does not silence the row
    - the plan cell opens the row exactly once

<!-- END proof -->

### SC-A11Y-005 — Focus stays visible

🟢 An outline is never removed without something equivalent put in its place.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-006 — Information is never carried by colour alone

🟢 A state signalled by colour is also signalled by an icon, a label or a description.

_Source:_ internal engineering guidelines

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/error-state-outranks-the-accent.test.ts`
    - the stylesheet the theme has to outrank really parsed
    - a focused valid field still gets the accent label
    - a focused invalid field keeps its negative label
    - an invalid field that was never focused keeps it too
    - a list item has no error state for the sibling rule to trample

<!-- END proof -->

### SC-A11Y-007 — An icon that carries meaning has a name that can be announced

🟢 An icon is not text, and a control that is only an icon needs a label beside it or attached to it.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-008 — Each screen has one heading that names it, and every section is labelled

🟢 A section without a title is left unlabelled rather than given an empty name, because an unnamed
landmark is worse than none.

_Source:_ `docs/explanation/design-guide.md`

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/admin-page-shell.test.ts`
    - renders the title as the page heading
    - omits the subtitle and the actions bar when neither is supplied
    - renders a markup subtitle through the slot
    - names the section by pointing aria-labelledby at its own heading
    - gives sibling sections distinct heading ids
    - renders no heading level above h2
    - the source sweep actually finds the pages it claims to check
    - AdminPage renders no &lt;main&gt; — the landmark belongs to AdminLayout
    - no content page renders its own &lt;main&gt; or a QPage
    - no content page hand-writes the hero markup instead of using AdminHero
    - AdminHero renders the only &lt;h1&gt; in the package
    - no view renders its hero inside the page body
    - no view hand-writes the reload button instead of using AdminRefreshBtn
    - no view writes its own table instead of using AdminTable
    - a component whose only job is to emit is never used without a listener
    - the actions column is filled through row-actions, not body-cell-actions
    - no page declares its own statistic tile styling
    - an unscoped page style reaches only its own sub-components
    - no page block titles itself with a heading-shaped &lt;div&gt;
    - no view writes its own disclosure instead of using AdminAccordion
    - the sweep reaches the pages it claims to check
    - no page reaches for Quasar directly
    - no page redeclares the frame the theme draws
    - a page imports only from the layers below it
    - no primitive hard-codes a user-visible string
    - no file grows past the budget for its layer

<!-- END proof -->

### SC-A11Y-009 — Motion respects a person who has asked for less of it

🟢 Including the animations SaaSiCat draws itself rather than borrows.

_Source:_ #206

### SC-A11Y-010 — Wide content scrolls rather than being cut off

🟢 A table that does not fit is reachable sideways; it is not clipped at the edge of the screen.

_Source:_ release 0.24.2

<!-- BEGIN proof -->

_Tested by:_

- `tests/px-to-scale.test.js`
    - an exact value takes its own token
    - a midpoint rounds down
    - a value nearer one rung takes it, up or down
    - radii use their names, not their numbers
    - a negative keeps its sign in a calc
    - tracking is converted rather than snapped
    - a property no scale answers for
    - a declaration that already reads a token
    - a token definition
    - every value in a shorthand moves together
    - a zero stays a zero
    - touches declarations and nothing else

<!-- END proof -->

### SC-A11Y-011 — A dialog does not stack on top of itself

🟢 One overlay per screen, not one per row, so focus is never trapped behind something a person
cannot see.

_Source:_ release 1.0.0-rc.0

<!-- BEGIN proof -->

_Tested by:_

- `packages/ui-vue/tests/component/one-dialog-per-page-not-per-row.test.ts`
    - the fixture renders several rows — without that this proves nothing
    - one instance exists, however many rows there are
- `packages/ui-vue/tests/use-dialog.test.js`
    - the panel carries the modal role and is named by its heading
    - opening moves focus into the panel
    - closing puts focus back where it was
    - a trigger that is gone by then leaves focus at the document body
    - unmounting while open still gives the focus back
    - tab from the last control wraps to the first
    - shift+tab from the first control wraps to the last
    - shift+tab from the panel itself wraps to the last control
    - a tab from outside the panel is pulled back in
    - a panel with nothing tabbable keeps the caret on itself
    - escape asks the caller to close
    - a persistent dialog ignores escape
    - a click on the backdrop closes, a click in the panel does not
    - a persistent dialog ignores the backdrop too
    - a closed dialog no longer answers escape
    - the lock is taken while open and given back on close
    - an inner dialog closing does not give the page back to the outer one
    - the default is body
    - a host that names a container gets it

<!-- END proof -->

### SC-A11Y-012 — Where a screen cannot meet the floor, the exception is named with its reason

🟢 And it stops being accepted once it no longer describes anything real.

_Source:_ `docs/explanation/design-guide.md`

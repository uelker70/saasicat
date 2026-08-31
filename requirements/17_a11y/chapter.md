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

### SC-A11Y-002 — Meaningful visuals stand out from what is next to them

🟢 Icons, control edges, status marks and chart elements are distinguishable from their surroundings
at no less than 3:1, and body text at no less than 4.5:1.

_Source:_ `docs/explanation/design-guide.md` · internal engineering guidelines

### SC-A11Y-003 — A colour used as a fill is not the same colour used as text

🟢 A status colour tuned to be read against the page goes lighter in the dark theme; the same value
used as a background with white text on it drops to 1.67:1. Each tone therefore has both roles,
and text on a filled surface stays legible in both themes.

_Source:_ release 1.0.0-rc.6

### SC-A11Y-004 — Every control can be reached and operated from the keyboard

🟢 A row that opens is a button, not an area that happens to respond to a click. Four of the eight
expandable surfaces this replaced could not be reached or announced at all, and a search for the
attribute that announces them returned nothing.

_Source:_ #133 · `docs/explanation/design-guide.md`

### SC-A11Y-005 — Focus stays visible

🟢 An outline is never removed without something equivalent put in its place.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-006 — Information is never carried by colour alone

🟢 A state signalled by colour is also signalled by an icon, a label or a description.

_Source:_ internal engineering guidelines

### SC-A11Y-007 — An icon that carries meaning has a name that can be announced

🟢 An icon is not text, and a control that is only an icon needs a label beside it or attached to it.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-008 — Each screen has one heading that names it, and every section is labelled

🟢 A section without a title is left unlabelled rather than given an empty name, because an unnamed
landmark is worse than none.

_Source:_ `docs/explanation/design-guide.md`

### SC-A11Y-009 — Motion respects a person who has asked for less of it

🟢 Including the animations SaaSiCat draws itself rather than borrows.

_Source:_ #206

### SC-A11Y-010 — Wide content scrolls rather than being cut off

🟢 A table that does not fit is reachable sideways; it is not clipped at the edge of the screen.

_Source:_ release 0.24.2

### SC-A11Y-011 — A dialog does not stack on top of itself

🟢 One overlay per screen, not one per row, so focus is never trapped behind something a person
cannot see.

_Source:_ release 1.0.0-rc.0

### SC-A11Y-012 — Where a screen cannot meet the floor, the exception is named with its reason

🟢 And it stops being accepted once it no longer describes anything real.

_Source:_ `docs/explanation/design-guide.md`

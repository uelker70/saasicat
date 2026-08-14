---
'@saasicat/ui-vue': patch
---

The three screens outside the admin shell are inside the theme.

The component layer corrects Quasar's own DOM — the outlined control's
transparent background, the 4px radii, the `#1d1d1d` card Quasar paints in dark
mode — and it reaches that DOM through exactly two classes: `.sa-page`, rendered
by `AdminPage`, and `.sa-portal`, which `createSuperAdminApp` sets on every
teleported node. The login screen, the first-run setup wizard and the
fail-closed manifest-error page render outside the shell and carried neither, so
no rule in `ui/theme/components/` had ever applied to them. They are the screens
a user sees before and instead of the admin.

Measured against the visual fixture rather than read off the source: of the
gated rules, five reached those screens once the marker was there. They now take
the theme's body colour instead of the browser's black and its body font instead
of Quasar's Roboto; their outlined inputs take `--sa-radius-field` and a real
surface instead of a transparent 4px control; the focused field's label takes
`--sa-color-accent-strong` rather than the raw brand; and the error page's card
takes `--sa-radius-card` and the slate surface, which is what removes the
neutral grey card from a dark page. The heading reset applies too: Quasar's
element-level `h1` had been giving the login and error titles a 96px line box.

Each screen keeps its own frame — its root class is more specific than
`.sa-page`, so the login's full-viewport height and padding are untouched.

Two consequences the marker exposed are fixed with it: the login's form now sits
the same distance below the heading whether or not the optional subtitle is
there (the gap used to be Quasar's stray line-height), and the error card no
longer stretches to the full height of the page frame.

`tests/theme-reaches-every-page.test.js` derives the reach markers from the
stylesheets — a class the component layer only ever prefixes and never styles —
and fails when a page under `pages-standard/` renders a root carrying none of
them.

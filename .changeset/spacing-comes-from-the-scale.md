---
'@saasicat/ui-vue': minor
'@saasicat/ui-vue-tenant': minor
---

Spacing, radii and tracking in the shipped components now read the design
tokens instead of pixel literals — 1,165 declarations across both packages.

**What moves.** Values that sat between two rungs snap to the nearer one, and
ties round down: `gap: 6px` becomes `var(--sa-space-2)` (4px), `padding: 14px`
becomes `var(--sa-space-4)` (12px), `border-radius: 6px` becomes
`var(--sa-radius-control)` (7px). Nothing moves by more than 2px, and the visual
suite confirms no page overflows at any breakpoint.

**Why it matters to you.** These are the subpaths that ship source, so your
build compiles them — and from here, overriding `--sa-space-*` or
`--sa-radius-*` changes the whole surface at once rather than the one component
that happened to read a token already. See
[design tokens](https://github.com/uelker70/saasicat/blob/main/docs/reference/design-tokens.md).

If you override individual component paddings in your own stylesheet, check
them once: the value they sit next to may have shifted by a rung.

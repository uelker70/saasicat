---
'@saasicat/ui-vue': patch
---

Three layout changes that landed with the breakpoint consolidation and deserve
naming in their own right.

**The plan-version editor reflows on its own width, not the window's.** It used
to stack its three columns below a viewport threshold, which is wrong in one of
the two drawer states by construction: with the 240px admin drawer open at
1024–1100px, `320px 1fr 360px` had only 784–860px to sit in, leaving the middle
column at 104–180px and clipping its form controls behind `overflow: hidden`. It
now uses a container query, so it stacks when _it_ is narrow regardless of what
else is on screen. If you embed `PlanVersionEditor` in a narrower shell than the
admin's, it will stack earlier than before — which is the point.

**The plan list scrolls horizontally instead of being cut off.** Its six-column
grid needs about 790px; below that the wrapper's `overflow: hidden`, which is
there for the corner radius, simply cut the far columns off.

**Quasar's stepper takes its colours from the theme.** Its inactive step titles
are a hard-coded grey that measured 2.68:1 on a white card. The active step keeps
Quasar's `text-primary` accent — that is the "you are here" affordance.

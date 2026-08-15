---
'@saasicat/ui-vue': patch
---

Five markers that painted white on a light colour are readable again, and the
audit that said there were none can now see the place they were written.

**The report was wrong, and that is the more useful half.** Its headline read
`hard-coded hex colours 0 in 0 files` while twelve literals sat in six
templates: three browser-chrome dots written out twice, three diff markers, and
three `p.color ?? '#94a3b8'` fallbacks that answered one question with two
different greys. The audit had only ever read `<style>` blocks and `<script>`
blocks — a colour in a template belonged to no category at all. A zero that is
wrong is worse than a number that is large, because it ends the search.

There is now a `colours in templates` category with a floor of zero, and it
reads the SFC's own parse rather than its text. That distinction is the whole
value: a slot is `#actions`, an input mask is `mask="######"`, an anchor is
`href="#top"` and a pull request is `(#124)` in a comment — none of them is a
colour, all of them look like one to a pattern, and this repo's numbers are
already four digits. Twenty-six cases pin both halves: what it finds, and what
it stays quiet about.

**The literals themselves said something.** Every one resolved to a primitive
the theme already names, and the three in the version diff were reaching past
the token layers because there was nothing to reach for: `feature` had a
`-surface` and an `-fg`, `quota` and `bundle` had no `-fg`. Both are added, and
they complete the entity family to the shape a tone has. A missing rung does not
stay missing — it becomes a literal somewhere.

**White does not sit on a status colour.** Every rung of `--sa-color-<tone>` and
`-strong` is chosen to be legible _as_ a colour against its own theme's surface,
which puts it in the middle of the lightness range — and nothing reads on the
middle. The diff panel's marker paired `--sa-color-fg-on-accent` with
`--sa-color-positive-strong` and measured **2.54:1 in both themes**, so it was
never a dark-mode defect and no amount of dark-mode review would have found it.
Its inline siblings measured 2.77:1 and 2.15:1. All of them are now the tint
plus the tone's `-fg`, which is what that slot is for: 4.84 / 9.21 for `add`,
5.98 / 10.80 for a feature row.

Two more of the same family: the bundle editor's selected feature key kept the
bare `--sa-color-accent` (2.92:1 on its own tint in dark) when the states around
it moved to `-strong`, and a marketing chip's `<em>` held `--sa-color-fg-subtle`
while `:hover` moved the surface underneath it to a 22 % accent tint (2.92:1).
The `<em>` now takes no colour of its own — the mono face and the smaller step
already set it apart, and a colour that does not follow its own background is a
pair nothing can check.

That shape is why these lasted. All five declared a foreground in one place and
its background in another — one rule further down, on an ancestor, or in a
template attribute — and the source checker needs both in one rule body to
measure anything; the browser checker never mounted the panel and never hovers.
The diff marker's rules now each carry both halves, so the checker reads them:
moving the geometry off the base rule is the fix, not a tidy-up.

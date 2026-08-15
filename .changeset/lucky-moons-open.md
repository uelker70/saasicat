---
'@saasicat/ui-vue': minor
---

`AdminAccordion` — one row-that-opens, instead of eight.

Eight surfaces in the admin opened a body from a header, in three incompatible
idioms, sharing no code. They agreed on nothing measurable: three header
paddings, three body paddings, two radii, two colours for the open border, two
transition durations, and hover feedback on exactly one of six despite five
setting `cursor: pointer`. That is not eight decisions — it is none. There is an
`AdminTable` and an `AdminSection`, and for "open this" there was nothing, so
every page wrote it again.

**The accessibility half matters more than the styling half.** Four of the eight
were a `<div>` with a click handler: no keyboard, no `tabindex`, nothing an
assistive technology could announce as a control. A grep for `aria-expanded`
across the whole package returned zero. A shared component wins that argument
once; eight surfaces had to win it eight times, and the score was 4:4.

```vue
<AdminAccordion :open="openId === row.id" @update:open="select(row.id)">
    <template #header><!-- the row --></template>
    <template #header-actions><!-- controls that must NOT toggle it --></template>
    <!-- the body, rendered only while open -->
</AdminAccordion>
```

Two of its three rules are structural rather than cosmetic. `header-actions`
renders **outside** the trigger, so a control there cannot fire the toggle on
the way past — the discovery cards relied on an `@click.stop` for that, and
interactive content nested in a `<button>` has no defined behaviour anyway. And
the page keeps `open`: five of the eight take it from outside, and the bundle
list ties opening one row to closing another and loading that bundle's versions
— a component that owned a boolean would fight it.

The bundle list and both discovery cards move onto it in this release. The
remaining surfaces follow; the marketing catalogue's row lives in a CSS grid
with `display: contents` and needs its own arrangement rather than this one.

**The badge is the component's, the glyph is the page's.** The row icon was
drawn three ways — a 34px accent-tinted square, a bare 22px glyph, and a bare
20px glyph coloured through a Quasar **palette** prop (`color="negative"`, which
reaches past the role layer entirely) — so the same kind of row did not look
like the same kind of row from one page to the next. `#mark` takes the glyph and
`AdminAccordion` draws the frame. `markTone` exists for the one row whose state
the badge should report, and it moves nothing but the colour.

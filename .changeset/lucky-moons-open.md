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
the page keeps `open`: five of the eight tie opening one row to closing another
and loading its data, so a component that owned a boolean would fight them.

The bundle list and both discovery cards move onto it in this release. The
remaining surfaces follow; the marketing catalogue's row lives in a CSS grid
with `display: contents` and needs its own arrangement rather than this one.

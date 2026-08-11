---
'@saasicat/ui-vue': minor
---

Give statistics one tile and sections one surface

Seven tile implementations existed across the admin pages. Two of them —
`sa-discovery__kpi` and `sa-bundles__kpi` — were byte identical. Three lived in
unscoped page-level `<style>` blocks, which is the construction that produced
the `sa-bundles__head` leak. There was no test on any of them.

`AdminStatistics` and `AdminKpi` replace all seven:

```vue
<AdminStatistics :columns="4">
  <AdminKpi label="Live" :value="liveCount" sub="published" tone="positive" />
</AdminStatistics>
```

`action` decides interactivity: with one the tile is a `<button>` carrying
`aria-pressed`, without one a `<div>`. The three filter strips never announced
their selected state before. `emphasis` keeps the one difference that was
real — filter pills colour the number, discovery and draft tiles tint the whole
tile, because there the colour is the statement. Two tiles set that tint with
inline `style` and were immune to theming; they use the tone now.

**Surfaces moved one level down.** `.sa-page` was the only thing painting the
canvas, so a page could not be transparent. The canvas now sits on the layout —
covering the gutters beside `max-width: 1600px` too — and sections carry the
surface, rounded, with a head that echoes the hero one shade lighter. Eight
sections that also carried `.sa-card` painted twice; the card is gone from them,
since a section is one.

**Breaking for CSS overrides.** `.sa-stat*` is gone (use `AdminKpi`), and
`components/KpiCard.vue` is deleted — it had no importer in this repo or in
either known consumer. An app that restyled `.sa-stat__num` should move to
`.sa-kpi__value`.

Five radius tokens (`--sa-radius-hero|section|card|head|tile`) replace the
scattered literals; `--sa-radius-tile` is the single declaration requirement
every tile resolves to. `--sa-bg-surface-2` names the `#f8fafc` inset grey.

The plans page finally has a hero subtitle.

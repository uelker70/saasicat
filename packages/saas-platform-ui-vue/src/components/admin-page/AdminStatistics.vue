<template>
    <div class="sa-stats" :style="columns ? gridStyle : undefined" :aria-label="label">
        <slot />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// A row of AdminKpi tiles. One arrangement, everywhere: tiles share a track
// width and their sub-lines land on one baseline.
//
// There is deliberately no layout variant. An earlier version offered a
// content-sized "strip" alongside the grid, and the result was two different
// looking KPI rows in the same admin — which is the kind of divergence a
// prescribed design element exists to prevent.
//
// `columns` caps the track count without a media query: the tiles collapse to
// fewer columns on their own once the minimum width no longer fits.
const props = defineProps<{
    /** Upper bound on tracks; fewer are used when they no longer fit. */
    columns?: number;
    /** Accessible name — worth setting when the tiles are interactive. */
    label?: string;
}>();

const TILE_MIN_WIDTH = '150px';
const GAP_PX = 10;

const gridStyle = computed(() => {
    const n = props.columns!;
    // The gap total is computed here rather than left as `(n - 1) * 10px` in
    // the declaration: a plain calc() sum is the conservative form, and one
    // rejected expression would drop the whole track list back to an uncapped
    // auto-fit — the cap would fail open, invisibly.
    const gaps = `${(n - 1) * GAP_PX}px`;
    const track = `max(${TILE_MIN_WIDTH}, calc((100% - ${gaps}) / ${n}))`;
    return { gridTemplateColumns: `repeat(auto-fit, minmax(${track}, 1fr))` };
});
</script>

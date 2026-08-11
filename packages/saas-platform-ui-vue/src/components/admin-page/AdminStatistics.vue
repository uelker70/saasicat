<template>
    <div
        :class="['sa-stats', layout === 'strip' && 'sa-stats--strip']"
        :style="layout === 'grid' && columns ? gridStyle : undefined"
        :role="label ? 'group' : undefined"
        :aria-label="label"
    >
        <slot />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// A row of AdminKpi tiles.
//
// `grid` is the default: tiles share a track width and their sub-lines land on
// one baseline. `strip` is for the clickable filter pills, which size to their
// content and wrap along a toolbar.
//
// `columns` caps the track count without a media query — the tiles collapse to
// fewer columns on their own once the minimum width no longer fits. The pages
// this replaces used two different breakpoints for the same intent.
const props = withDefaults(
    defineProps<{
        layout?: 'grid' | 'strip';
        /** Upper bound on tracks; fewer are used when they no longer fit. */
        columns?: number;
        /** Accessible name — worth setting when the tiles are interactive. */
        label?: string;
    }>(),
    { layout: 'grid' },
);

const TILE_MIN_WIDTH = '150px';
const GAP = '10px';

const gridStyle = computed(() => {
    const n = props.columns!;
    const track = `max(${TILE_MIN_WIDTH}, (100% - (${n} - 1) * ${GAP}) / ${n})`;
    return { gridTemplateColumns: `repeat(auto-fit, minmax(${track}, 1fr))` };
});
</script>

<template>
    <div class="sp-card">
        <slot />
    </div>
</template>

<script setup lang="ts">
// The bordered surface every panel in this package sits on: the plan card, the
// package snapshot, a bundle tile, the body of a dialog.
//
// One element and one set of declarations, and that is deliberate — `q-card`
// carried a flat/bordered/elevated matrix this package used exactly one cell
// of (`flat bordered`, six times). What it does NOT carry is padding: the
// sections inside own that, so a card can hold a grid of tiles as easily as a
// stack of sections.
</script>

<style scoped>
.sp-card {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-card);
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-fg-body);
}
</style>

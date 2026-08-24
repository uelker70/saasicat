<template>
    <div class="kv">
        <div class="kv__label">{{ label }}</div>
        <div class="kv__value">{{ value }}</div>
    </div>
</template>

<script setup lang="ts">
// Generic key-value display block. Used on detail pages and
// everywhere a label/value pair should be rendered in a consistent
// style.

defineProps<{ label: string; value: string }>();
</script>

<style scoped>
.kv {
    background: var(--sa-color-bg-sunken);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-tile);
    padding: var(--sa-space-3) var(--sa-space-4);
}
.kv__label {
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    font-weight: 700;
}
.kv__value {
    font-size: var(--sa-text-lg);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
    margin-top: var(--sa-space-2);
}
</style>

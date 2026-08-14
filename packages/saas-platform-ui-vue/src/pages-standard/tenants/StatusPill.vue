<template>
    <span class="sa-pill" :class="`sa-pill--${tone}`">
        <q-icon v-if="icon" :name="icon" size="11px" />
        {{ label }}
    </span>
</template>

<script setup lang="ts">
// Generic status pill for tenant status, pilot marker,
// suspended marker etc. Apps pass `label`/`icon`/`tone` through and
// combine several pills side by side for composite status
// displays (e.g. "Aktiv + PILOT" or "Trial + SUSPENDIERT").

export type PillTone = 'positive' | 'warning' | 'negative' | 'muted' | 'primary' | 'accent';

defineProps<{
    label: string;
    icon?: string;
    tone: PillTone;
}>();
</script>

<style scoped>
.sa-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--sa-text-xs);
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 3px 8px;
    border-radius: 5px;
    white-space: nowrap;
}
.sa-sa-pill :deep(.q-icon) {
    color: inherit;
}
.sa-pill--positive {
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive-fg);
}
.sa-pill--warning {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
.sa-pill--negative {
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative);
}
.sa-pill--muted {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-muted);
}
.sa-pill--primary {
    background: var(--sa-color-accent-surface);
    color: var(--sa-color-accent-strong);
}
.sa-pill--accent {
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
}
</style>

<template>
    <span class="sa-pill" :class="`sa-pill--${tone}`">
        <q-icon v-if="icon" :name="icon" size="11px" />
        {{ label }}
    </span>
</template>

<script setup lang="ts">
// Generische Status-Pill für Tenant-Status, Pilot-Markierung,
// Suspended-Markierung etc. Apps reichen `label`/`icon`/`tone` durch und
// kombinieren mehrere Pills nebeneinander für zusammengesetzte Status-
// Anzeigen (z. B. "Aktiv + PILOT" oder "Trial + SUSPENDIERT").

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
    font-size: 10.5px;
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
    background: var(--sa-positive-soft, rgba(4, 120, 87, 0.1));
    color: var(--sa-positive, #047857);
}
.sa-pill--warning {
    background: var(--sa-warning-soft, rgba(245, 158, 11, 0.1));
    color: var(--sa-warning, #b45309);
}
.sa-pill--negative {
    background: var(--sa-negative-soft, rgba(220, 38, 38, 0.08));
    color: var(--sa-negative, #dc2626);
}
.sa-pill--muted {
    background: #f1f5f9;
    color: var(--sa-muted, #64748b);
}
.sa-pill--primary {
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    color: var(--sa-primary, #3f6bff);
}
.sa-pill--accent {
    background: rgba(245, 158, 11, 0.16);
    color: #b45309;
}
</style>

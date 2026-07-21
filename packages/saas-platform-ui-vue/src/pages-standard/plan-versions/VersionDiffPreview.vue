<template>
    <div v-if="!changes || changes.length === 0" class="sa-pv-diff-preview__empty">
        Keine Änderungen gegenüber der Vorgängerversion.
    </div>
    <div v-else class="sa-pv-diff-preview__list">
        <div
            v-for="(c, idx) in changes"
            :key="idx"
            class="sa-pv-diff-preview__row"
            :class="rowClass(c.direction)"
        >
            <div class="sa-pv-diff-preview__direction">
                <q-icon :name="iconFor(c.direction)" size="16px" />
                <span>{{ labelFor(c.direction) }}</span>
            </div>
            <div class="sa-pv-diff-preview__field">{{ humanFieldLabel(c.field) }}</div>
            <div class="sa-pv-diff-preview__values">
                <span v-if="c.field !== 'features.added'" class="old">{{
                    formatValue(c.oldValue)
                }}</span>
                <q-icon
                    v-if="c.field !== 'features.added' && c.field !== 'features.removed'"
                    name="arrow_forward"
                    size="14px"
                />
                <span v-if="c.field !== 'features.removed'" class="new">{{
                    formatValue(c.newValue)
                }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VersionChange } from '@saasicat/types';

const props = defineProps<{
    changes?: VersionChange[] | null;
    /**
     * Optional: field labels (e.g. `{ maxUsers: 'Max. Benutzer' }`).
     * Apps map their own Quota fields here; the default covers the generic
     * platform fields.
     */
    fieldLabels?: Record<string, string>;
}>();

const DEFAULT_FIELD_LABELS: Record<string, string> = {
    'features.added': 'Hinzugefügte Features',
    'features.removed': 'Entfernte Features',
    maxUsers: 'Max. Benutzer',
    maxStorageGb: 'Speicher (GB)',
    monthlyNet: 'Preis monatlich (netto)',
    yearlyNet: 'Preis jährlich (netto)',
    unitSize: 'Einheitsgröße',
};

const mergedFieldLabels = computed(() => ({
    ...DEFAULT_FIELD_LABELS,
    ...(props.fieldLabels ?? {}),
}));

function iconFor(direction: VersionChange['direction']): string {
    if (direction === 'IMPROVEMENT') return 'trending_up';
    if (direction === 'REGRESSION') return 'trending_down';
    return 'remove';
}

function labelFor(direction: VersionChange['direction']): string {
    if (direction === 'IMPROVEMENT') return 'Verbesserung';
    if (direction === 'REGRESSION') return 'Verschlechterung';
    return 'Neutral';
}

function rowClass(direction: VersionChange['direction']): string {
    if (direction === 'IMPROVEMENT') return 'sa-pv-diff-preview__row--improvement';
    if (direction === 'REGRESSION') return 'sa-pv-diff-preview__row--regression';
    return 'sa-pv-diff-preview__row--neutral';
}

function humanFieldLabel(field: string): string {
    return mergedFieldLabels.value[field] ?? field;
}

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return '–';
    if (Array.isArray(value)) {
        if (value.length === 0) return '–';
        return value.join(', ');
    }
    if (typeof value === 'string' && /^\d+\.\d{2}$/.test(value)) {
        return `${value} €`;
    }
    return String(value);
}
</script>

<style scoped>
.sa-pv-diff-preview__empty {
    color: #64748b;
    font-style: italic;
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px dashed #cbd5e1;
}
.sa-pv-diff-preview__list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.sa-pv-diff-preview__row {
    display: grid;
    grid-template-columns: 160px 200px 1fr;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid;
    font-size: 13px;
    align-items: center;
}
.sa-pv-diff-preview__row--improvement {
    background: #f0fdf4;
    border-color: #bbf7d0;
    color: #166534;
}
.sa-pv-diff-preview__row--regression {
    background: #fef2f2;
    border-color: #fecaca;
    color: #991b1b;
}
.sa-pv-diff-preview__row--neutral {
    background: #f8fafc;
    border-color: #e2e8f0;
    color: #475569;
}
.sa-pv-diff-preview__direction {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.sa-pv-diff-preview__field {
    color: #0f172a;
    font-weight: 500;
}
.sa-pv-diff-preview__values {
    display: flex;
    align-items: center;
    gap: 8px;
}
.sa-pv-diff-preview__values .old {
    color: #94a3b8;
    text-decoration: line-through;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
}
.sa-pv-diff-preview__values .new {
    color: inherit;
    font-weight: 600;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 12px;
}
</style>

<template>
    <div v-if="!changes || changes.length === 0" class="diff-empty">
        Keine Änderungen gegenüber der Vorgängerversion.
    </div>
    <div v-else class="diff-list">
        <div v-for="(c, idx) in changes" :key="idx" class="diff-row" :class="rowClass(c.direction)">
            <div class="diff-direction">
                <q-icon :name="iconFor(c.direction)" size="16px" />
                <span>{{ labelFor(c.direction) }}</span>
            </div>
            <div class="diff-field">{{ humanFieldLabel(c.field) }}</div>
            <div class="diff-values">
                <span class="old" v-if="c.field !== 'features.added'">{{
                    formatValue(c.oldValue)
                }}</span>
                <q-icon
                    v-if="c.field !== 'features.added' && c.field !== 'features.removed'"
                    name="arrow_forward"
                    size="14px"
                />
                <span class="new" v-if="c.field !== 'features.removed'">{{
                    formatValue(c.newValue)
                }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { VersionChange } from '@saasicat/types';

// Plattform-Default-Field-Labels (Plan-Catalog-Quotas + Pricing).
// Konsumenten-Apps koennen via `fieldLabels`-Prop App-spezifische Labels
// (z. B. AutohausPro: maxVehicles; vereinsfux: maxMembers) ergaenzen oder
// ueberschreiben.
const PLATFORM_FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
    'features.added': 'Hinzugefügte Features',
    'features.removed': 'Entfernte Features',
    maxUsers: 'Max. Benutzer',
    maxStorageGb: 'Speicher (GB)',
    monthlyNet: 'Preis monatlich (netto)',
    yearlyNet: 'Preis jährlich (netto)',
    unitSize: 'Einheitsgröße',
});

const props = defineProps<{
    changes?: VersionChange[] | null;
    /** App-spezifische Field-Labels; werden mit Plattform-Defaults gemerged. */
    fieldLabels?: Record<string, string>;
}>();

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
    if (direction === 'IMPROVEMENT') return 'diff-row--improvement';
    if (direction === 'REGRESSION') return 'diff-row--regression';
    return 'diff-row--neutral';
}

function humanFieldLabel(field: string): string {
    return props.fieldLabels?.[field] ?? PLATFORM_FIELD_LABELS[field] ?? field;
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
.diff-empty {
    color: #64748b;
    font-style: italic;
    padding: 12px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px dashed #cbd5e1;
}
.diff-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.diff-row {
    display: grid;
    grid-template-columns: 160px 200px 1fr;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid;
    font-size: 13px;
    align-items: center;
}
.diff-row--improvement {
    background: #f0fdf4;
    border-color: #bbf7d0;
    color: #166534;
}
.diff-row--regression {
    background: #fef2f2;
    border-color: #fecaca;
    color: #991b1b;
}
.diff-row--neutral {
    background: #f8fafc;
    border-color: #e2e8f0;
    color: #475569;
}
.diff-direction {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.diff-field {
    color: #0f172a;
    font-weight: 500;
}
.diff-values {
    display: flex;
    align-items: center;
    gap: 8px;
}
.diff-values .old {
    text-decoration: line-through;
    opacity: 0.7;
}
.diff-values .new {
    font-weight: 600;
}
</style>

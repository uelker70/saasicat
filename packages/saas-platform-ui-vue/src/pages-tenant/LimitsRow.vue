<template>
    <tr class="sp-limits-row" :class="{ 'sp-limits-row--exceeded': row.exceeded }">
        <td class="sp-limits-row__label">{{ label }}</td>
        <td class="sp-limits-row__used">{{ formatValue(row.used) }}</td>
        <td class="sp-limits-row__current">{{ formatMax(row.currentMax) }}</td>
        <td class="sp-limits-row__target">
            <span
                :class="row.exceeded ? 'sp-limits-row__target--bad' : 'sp-limits-row__target--ok'"
            >
                {{ formatMax(row.targetMax) }}
            </span>
        </td>
    </tr>
</template>

<script setup lang="ts">
// LimitsRow — eine Zeile in der Limits-Vergleichs-Tabelle des Plan-Change-
// Wizards (Verbrauch / Aktuelles Limit / Ziel-Limit, exceeded farblich
// hervorgehoben). Wird vom PlanChangeWizard für jeden quotaKey aus
// `preview.limitsCheck` gerendert.

interface Props {
    label: string;
    row: {
        used: number;
        currentMax: number;
        targetMax: number;
        exceeded: boolean;
    };
    fractional?: boolean;
}

const props = defineProps<Props>();

function formatValue(n: number): string {
    return props.fractional ? n.toFixed(1) : Math.round(n).toString();
}

function formatMax(n: number): string {
    if (n === -1) return '∞';
    return formatValue(n);
}
</script>

<style scoped>
.sp-limits-row {
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.sp-limits-row td {
    padding: 8px 12px;
    font-variant-numeric: tabular-nums;
}
.sp-limits-row__label {
    font-weight: 500;
}
.sp-limits-row__target--ok {
    color: var(--q-positive, #21ba45);
    font-weight: 600;
}
.sp-limits-row__target--bad {
    color: var(--q-negative, #c10015);
    font-weight: 600;
}
.sp-limits-row--exceeded {
    background: rgba(193, 0, 21, 0.05);
}
</style>

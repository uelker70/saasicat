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
// LimitsRow — one row in the limits comparison table of the plan change
// wizard (usage / current limit / target limit, exceeded highlighted in
// color). Rendered by the PlanChangeWizard for each quotaKey from
// `preview.limitsCheck`.

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
    border-bottom: 1px solid var(--sa-color-border-soft);
}
.sp-limits-row td {
    padding: var(--sa-space-3) var(--sa-space-4);
    font-variant-numeric: tabular-nums;
}
.sp-limits-row__label {
    font-weight: 500;
}
.sp-limits-row__target--ok {
    color: var(--sa-color-positive);
    font-weight: 600;
}
.sp-limits-row__target--bad {
    color: var(--sa-color-negative);
    font-weight: 600;
}
.sp-limits-row--exceeded {
    background: var(--sa-color-negative-surface);
}
</style>

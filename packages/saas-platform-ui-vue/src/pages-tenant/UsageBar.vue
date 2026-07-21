<template>
    <div class="sp-usage-bar" :class="`sp-usage-bar--${tone}`">
        <div class="sp-usage-bar__head">
            <span class="sp-usage-bar__label">{{ label }}</span>
            <span class="sp-usage-bar__values"> {{ formattedUsed }} / {{ formattedMax }} </span>
        </div>
        <div class="sp-usage-bar__track">
            <div class="sp-usage-bar__fill" :style="{ width: `${percent}%` }" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

// UsageBar — generic usage display for a single limit dimension. The consumer
// passes label, usage and maximum through. `-1` as the maximum = unlimited
// (Catalog convention), rendered as ∞.

interface Props {
    label: string;
    used: number;
    max: number;
    /** Format hook: integer by default, storage is shown with 1 decimal place. */
    fractional?: boolean;
    /**
     * Custom value formatter. Applied to `used` and (unless ∞) `max`.
     * Allows, for example, adaptive units ("5.75 MB" vs. "5 GB") for small
     * fractional values without UsageBar needing to know the unit.
     */
    formatValue?: (value: number) => string;
}

const props = defineProps<Props>();

const isUnlimited = computed(() => props.max === -1);

const percent = computed(() => {
    if (isUnlimited.value) return 0;
    if (props.max <= 0) return 0;
    return Math.min(100, Math.round((props.used / props.max) * 100));
});

const tone = computed(() => {
    if (isUnlimited.value) return 'ok';
    if (props.max <= 0) return 'ok';
    const ratio = props.used / props.max;
    if (ratio >= 1) return 'full';
    if (ratio >= 0.8) return 'warn';
    return 'ok';
});

function defaultFormat(value: number): string {
    return props.fractional ? value.toFixed(1) : Math.round(value).toString();
}

const formattedUsed = computed(() =>
    props.formatValue ? props.formatValue(props.used) : defaultFormat(props.used),
);
const formattedMax = computed(() => {
    if (isUnlimited.value) return '∞';
    return props.formatValue ? props.formatValue(props.max) : defaultFormat(props.max);
});
</script>

<style scoped>
.sp-usage-bar {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.sp-usage-bar__head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
}
.sp-usage-bar__label {
    color: var(--q-secondary, #555);
    font-weight: 500;
}
.sp-usage-bar__values {
    font-variant-numeric: tabular-nums;
    color: var(--q-secondary, #555);
}
.sp-usage-bar__track {
    width: 100%;
    height: 8px;
    background: rgba(0, 0, 0, 0.08);
    border-radius: 4px;
    overflow: hidden;
}
.sp-usage-bar__fill {
    height: 100%;
    transition: width 200ms ease;
    border-radius: 4px;
}
.sp-usage-bar--ok .sp-usage-bar__fill {
    background: var(--q-positive, #21ba45);
}
.sp-usage-bar--warn .sp-usage-bar__fill {
    background: var(--q-warning, #f2c037);
}
.sp-usage-bar--full .sp-usage-bar__fill {
    background: var(--q-negative, #c10015);
}
</style>

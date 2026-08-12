<template>
    <div class="sp-cycle" role="radiogroup" :aria-label="labels.ariaLabel">
        <button
            type="button"
            class="sp-cycle__btn"
            :class="{ 'sp-cycle__btn--active': modelValue === 'MONTHLY' }"
            role="radio"
            :aria-checked="modelValue === 'MONTHLY'"
            @click="emit('update:modelValue', 'MONTHLY')"
        >
            {{ labels.monthly }}
        </button>
        <button
            type="button"
            class="sp-cycle__btn"
            :class="{ 'sp-cycle__btn--active': modelValue === 'YEARLY' }"
            role="radio"
            :aria-checked="modelValue === 'YEARLY'"
            @click="emit('update:modelValue', 'YEARLY')"
        >
            {{ labels.yearly }}
            <span v-if="labels.savePill" class="sp-cycle__pill">{{ labels.savePill }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { BillingCycleStr } from '../../vue/use-tenant-billing.js';

interface I18n {
    ariaLabel?: string;
    monthly?: string;
    yearly?: string;
    /** Optional: Spar-Pill neben "Jährlich" (z. B. "−2 Mt"). */
    savePill?: string;
}

const props = defineProps<{
    modelValue: BillingCycleStr;
    /** Per-string overrides; unset entries fall back to the platform catalog. */
    i18n?: I18n;
}>();

const emit = defineEmits<{
    'update:modelValue': [BillingCycleStr];
}>();

const msg = useSaMessages('plans');
const common = useSaMessages('common');

const labels = computed(() => ({
    ariaLabel: props.i18n?.ariaLabel ?? msg.value.cycle.ariaLabel,
    monthly: props.i18n?.monthly ?? common.value.monthly,
    yearly: props.i18n?.yearly ?? common.value.yearly,
    savePill: props.i18n?.savePill,
}));
</script>

<style scoped>
.sp-cycle {
    display: inline-flex;
    --sp-cycle-bg: var(--sa-color-accent-surface-soft);
    --sp-cycle-btn-fg: var(--sa-color-fg-muted);
    --sp-cycle-btn-active-bg: var(--sa-color-bg-surface);
    --sp-cycle-btn-active-fg: var(--sa-color-accent);
    background: var(--sp-cycle-bg);
    border-radius: 12px;
    padding: 3px;
    gap: 2px;
}
.sp-cycle__btn {
    padding: 8px 14px;
    border: none;
    background: none;
    font-family: inherit;
    font-size: var(--sa-text-sm);
    font-weight: 700;
    color: var(--sp-cycle-btn-fg);
    cursor: pointer;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    letter-spacing: 0.02em;
    transition: all 180ms;
}
.sp-cycle__btn--active {
    background: var(--sp-cycle-btn-active-bg);
    color: var(--sp-cycle-btn-active-fg);
    box-shadow: 0 2px 8px var(--sa-shadow-tint-3);
}
.sp-cycle__pill {
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
    font-size: var(--sa-text-2xs);
    padding: 2px 7px;
    border-radius: 999px;
    font-family: 'SF Mono', Consolas, monospace;
    letter-spacing: 0.04em;
}
</style>

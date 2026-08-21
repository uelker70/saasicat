<template>
    <div class="sp-models">
        <button
            v-for="plan in plans"
            :key="plan.id"
            type="button"
            class="sp-model"
            :class="{
                'sp-model--selected': modelValue === plan.id,
                'sp-model--current': plan.id === currentPlanId,
            }"
            :aria-pressed="modelValue === plan.id"
            @click="emit('update:modelValue', plan.id)"
        >
            <span v-if="plan.popular && plan.id !== currentPlanId" class="sp-model__flag">
                {{ i18n.popular }}
            </span>
            <span
                v-else-if="plan.id === currentPlanId"
                class="sp-model__flag sp-model__flag--current"
            >
                {{ i18n.current }}
            </span>

            <div class="sp-model__name">{{ plan.name }}</div>
            <div class="sp-model__tagline">{{ plan.tagline }}</div>

            <div class="sp-model__price">
                <template v-if="planPrice(plan) !== null">
                    <strong>{{ formatCurrency(planPrice(plan)!) }}</strong>
                    <span class="sp-model__price-cycle">
                        /{{ cycle === 'YEARLY' ? i18n.perYear : i18n.perMonth }}
                    </span>
                </template>
                <template v-else>
                    {{ i18n.priceOnRequest }}
                </template>
            </div>

            <div class="sp-model__quotas">
                <div v-for="key in catalogQuotaKeys" :key="key" class="sp-model__quota">
                    <strong>{{ formatQuotaValue(key, plan.quotas[key]) }}</strong>
                    <span>{{ quotaLabel(key) }}</span>
                </div>
            </div>
        </button>
    </div>
</template>

<script setup lang="ts">
import type { CatalogPlan } from '../../vue/use-tenant-billing-catalog.js';
import type { BillingCycleStr } from '../../vue/use-tenant-billing.js';

interface I18n {
    popular: string;
    current: string;
    perMonth: string;
    perYear: string;
    priceOnRequest: string;
}

const props = defineProps<{
    modelValue: string | null;
    plans: CatalogPlan[];
    cycle: BillingCycleStr;
    /** quotaKeys to display, in order. */
    catalogQuotaKeys: string[];
    /** Current subscription, optional — when set, the plan card is marked with "Aktuell". */
    currentPlanId?: string | null;
    formatCurrency: (n: number) => string;
    /** Formats a single Quota value (`-1` → ∞, otherwise number + unit). */
    formatQuotaValue: (key: string, value: number) => string;
    quotaLabel: (key: string) => string;
    i18n: I18n;
}>();

const emit = defineEmits<{
    'update:modelValue': [string];
}>();

function planPrice(plan: CatalogPlan): number | null {
    if (props.cycle === 'YEARLY') {
        return plan.yearlyNet ?? (plan.monthlyNet != null ? plan.monthlyNet * 10 : null);
    }
    return plan.monthlyNet;
}
</script>

<style scoped>
.sp-models {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
}
/* This component's knobs, all of them reading a role. The dark set that used to
 * sit below is gone: the roles carry the theme now, so nine values were being
 * maintained twice to say what `--sa-color-*` already says once. */
.sp-models {
    --sp-card-bg: var(--sa-color-bg-surface);
    --sp-card-border: var(--sa-color-border);
    --sp-card-border-soft: var(--sa-color-border-soft);
    --sp-card-current-bg: var(--sa-color-bg-sunken);
    --sp-card-selected-grad: var(--sa-color-accent-surface-soft);
    --sp-text-strong: var(--sa-color-fg-heading);
    --sp-text-muted: var(--sa-color-fg-muted);
    /* The flag is an inversion of the card: it paints a foreground colour as
     * its surface, so its text has to be the background colour. Pairing it
     * with `--sa-color-fg-on-accent` held only in light mode — that role is
     * white in both themes, while this surface turns light in dark, and white
     * on `--sa-neutral-300` reads 1.48:1. */
    --sp-flag-current-bg: var(--sa-color-fg-secondary);
    --sp-flag-current-fg: var(--sa-color-bg-surface);
}
.sp-model {
    position: relative;
    text-align: left;
    cursor: pointer;
    font-family: inherit;
    background: var(--sp-card-bg);
    border: 1.5px solid var(--sp-card-border);
    border-radius: 18px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: all 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
    color: var(--sp-text-strong);
}
.sp-model:hover {
    transform: translateY(-3px);
    border-color: var(--sa-color-accent);
}
.sp-model--selected {
    border-color: var(--sa-color-accent);
    background: linear-gradient(180deg, var(--sp-card-selected-grad), var(--sp-card-bg) 70%);
    box-shadow: 0 14px 30px var(--sa-shadow-tint-3);
}
.sp-model--current {
    background: var(--sp-card-current-bg);
}
.sp-model__flag {
    position: absolute;
    top: -10px;
    right: 14px;
    background: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 999px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
.sp-model__flag--current {
    background: var(--sp-flag-current-bg);
    color: var(--sp-flag-current-fg);
}
.sp-model__name {
    font-size: var(--sa-text-xl);
    font-weight: 700;
    color: var(--sp-text-strong);
}
.sp-model__tagline {
    font-size: var(--sa-text-sm);
    color: var(--sp-text-muted);
    line-height: 1.4;
}
.sp-model__price {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-top: 4px;
}
.sp-model__price strong {
    font-size: var(--sa-text-2xl);
    font-weight: 800;
    color: var(--sp-text-strong);
}
.sp-model__price-cycle {
    font-size: var(--sa-text-xs);
    color: var(--sp-text-muted);
}
.sp-model__quotas {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
    gap: 6px;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px dashed var(--sp-card-border-soft);
}
.sp-model__quota {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--sa-text-xs);
}
.sp-model__quota strong {
    font-size: var(--sa-text-lg);
    color: var(--sp-text-strong);
}
.sp-model__quota span {
    color: var(--sp-text-muted);
    font-size: var(--sa-text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
</style>

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
import type { CatalogPlan } from '../../use-tenant-billing-catalog.js';
import type { BillingCycleStr } from '../../use-tenant-billing.js';

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
/* CSS vars for light + dark mode. Quasar's `body--dark` triggers the dark set. */
.sp-models {
    --sp-card-bg: #fff;
    --sp-card-border: rgba(0, 0, 0, 0.1);
    --sp-card-border-soft: rgba(0, 0, 0, 0.08);
    --sp-card-current-bg: rgba(0, 0, 0, 0.02);
    --sp-card-selected-grad: rgba(15, 118, 110, 0.04);
    --sp-text-strong: rgba(0, 0, 0, 0.85);
    --sp-text-muted: rgba(0, 0, 0, 0.55);
    --sp-flag-current-bg: rgba(0, 0, 0, 0.6);
    --sp-flag-current-fg: #fff;
}
:global(.body--dark) .sp-models {
    --sp-card-bg: rgba(255, 255, 255, 0.06);
    --sp-card-border: rgba(255, 255, 255, 0.2);
    --sp-card-border-soft: rgba(255, 255, 255, 0.12);
    --sp-card-current-bg: rgba(255, 255, 255, 0.1);
    --sp-card-selected-grad: rgba(15, 118, 110, 0.25);
    --sp-text-strong: rgba(255, 255, 255, 0.92);
    --sp-text-muted: rgba(255, 255, 255, 0.65);
    --sp-flag-current-bg: rgba(255, 255, 255, 0.85);
    --sp-flag-current-fg: #0f172a;
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
    border-color: rgba(15, 118, 110, 0.55);
}
.sp-model--selected {
    border-color: var(--q-primary, #0f766e);
    background: linear-gradient(180deg, var(--sp-card-selected-grad), var(--sp-card-bg) 70%);
    box-shadow: 0 14px 30px rgba(15, 118, 110, 0.16);
}
.sp-model--current {
    background: var(--sp-card-current-bg);
}
.sp-model__flag {
    position: absolute;
    top: -10px;
    right: 14px;
    background: var(--q-primary, #0f766e);
    color: #fff;
    font-size: 10px;
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
    font-size: 17px;
    font-weight: 700;
    color: var(--sp-text-strong);
}
.sp-model__tagline {
    font-size: 12px;
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
    font-size: 22px;
    font-weight: 800;
    color: var(--sp-text-strong);
}
.sp-model__price-cycle {
    font-size: 11px;
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
    font-size: 11px;
}
.sp-model__quota strong {
    font-size: 14px;
    color: var(--sp-text-strong);
}
.sp-model__quota span {
    color: var(--sp-text-muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
</style>

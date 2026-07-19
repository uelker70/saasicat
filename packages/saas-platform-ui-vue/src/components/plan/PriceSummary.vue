<template>
    <aside class="sp-summary">
        <div class="sp-summary__head">
            <div class="sp-summary__title">{{ planName ?? i18n.noPlan }}</div>
            <div class="sp-summary__cycle">
                {{ pricing.cycle === 'YEARLY' ? i18n.cycleYearly : i18n.cycleMonthly }}
            </div>
        </div>

        <div class="sp-summary__body">
            <div v-if="pricing.breakdown.plan" class="sp-summary__group">
                <div class="sp-summary__group-head">{{ i18n.sectionPlan }}</div>
                <div class="sp-summary__line">
                    <div>
                        <strong>{{ pricing.breakdown.plan.label }}</strong>
                        <small v-if="pricing.breakdown.plan.sublabel">
                            {{ pricing.breakdown.plan.sublabel }}
                        </small>
                    </div>
                    <div class="sp-summary__price">
                        {{ formatCurrency(pricing.breakdown.plan.net) }}
                    </div>
                </div>
            </div>

            <div v-if="pricing.breakdown.bundles.length > 0" class="sp-summary__group">
                <div class="sp-summary__group-head">
                    {{ i18n.sectionBundles }} ({{ pricing.breakdown.bundles.length }})
                </div>
                <div
                    v-for="item in pricing.breakdown.bundles"
                    :key="item.key"
                    class="sp-summary__line"
                >
                    <div>
                        <strong>{{ item.label }}</strong>
                    </div>
                    <div class="sp-summary__price">{{ formatCurrency(item.net) }}</div>
                </div>
            </div>

            <div v-if="pricing.breakdown.bundles.length === 0" class="sp-summary__empty">
                {{ i18n.empty }}
            </div>
        </div>

        <div class="sp-summary__foot">
            <div class="sp-summary__row">
                <span>{{ i18n.subtotal }}</span>
                <span>{{ formatCurrency(pricing.subtotalNet) }}</span>
            </div>
            <div v-if="pricing.discountNet > 0" class="sp-summary__row sp-summary__row--discount">
                <span>{{ i18n.discount }}</span>
                <span>−{{ formatCurrency(pricing.discountNet) }}</span>
            </div>

            <slot name="promo-input" />

            <div class="sp-summary__total">
                <div class="sp-summary__total-l">
                    {{ i18n.total }}
                    <small>{{
                        pricing.cycle === 'YEARLY' ? i18n.totalUnitYearly : i18n.totalUnitMonthly
                    }}</small>
                </div>
                <div class="sp-summary__total-r">{{ formatCurrency(pricing.totalNet) }}</div>
            </div>

            <div
                v-if="pricing.cycle === 'YEARLY' && pricing.yearSavings > 0.5"
                class="sp-summary__savings"
            >
                {{ i18n.yearSavings.replace('{amount}', formatCurrency(pricing.yearSavings)) }}
            </div>

            <slot name="cta">
                <button
                    type="button"
                    class="sp-summary__cta"
                    :disabled="ctaDisabled || pricing.subtotalNet <= 0"
                    @click="emit('submit')"
                >
                    {{ ctaLabel }}
                </button>
            </slot>

            <div v-if="i18n.disclaimer" class="sp-summary__disclaimer">{{ i18n.disclaimer }}</div>
        </div>
    </aside>
</template>

<script setup lang="ts">
import type { DraftPricing } from '../../use-subscription-draft.js';

interface I18n {
    noPlan: string;
    cycleMonthly: string;
    cycleYearly: string;
    sectionPlan: string;
    sectionBundles: string;
    empty: string;
    subtotal: string;
    discount: string;
    total: string;
    totalUnitMonthly: string;
    totalUnitYearly: string;
    /** Mit `{amount}`-Platzhalter, z. B. "Du sparst {amount}/Jahr". */
    yearSavings: string;
    /** Optional: Disclaimer-Text unter CTA. */
    disclaimer?: string;
}

defineProps<{
    pricing: DraftPricing;
    planName: string | null;
    formatCurrency: (n: number) => string;
    ctaLabel: string;
    ctaDisabled?: boolean;
    i18n: I18n;
}>();

const emit = defineEmits<{
    submit: [];
}>();
</script>

<style scoped>
.sp-summary {
    background: #fff;
    border: 1.5px solid rgba(0, 0, 0, 0.85);
    border-radius: 22px;
    overflow: hidden;
    box-shadow: 0 24px 80px rgba(31, 41, 51, 0.1);
    position: sticky;
    top: 24px;
}
.sp-summary__head {
    padding: 16px 20px 14px;
    background: rgba(0, 0, 0, 0.85);
    color: #fff;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
}
.sp-summary__title {
    font-size: 18px;
    font-weight: 700;
}
.sp-summary__cycle {
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(255, 255, 255, 0.16);
    padding: 4px 9px;
    border-radius: 999px;
}
.sp-summary__body {
    padding: 16px 20px 4px;
    max-height: 50vh;
    overflow-y: auto;
}
.sp-summary__group {
    margin-bottom: 14px;
}
.sp-summary__group-head {
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(0, 0, 0, 0.5);
    font-weight: 700;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    margin-bottom: 6px;
}
.sp-summary__line {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: baseline;
    padding: 4px 0;
    font-size: 13px;
}
.sp-summary__line strong {
    font-weight: 600;
}
.sp-summary__line small {
    display: block;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 9.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(0, 0, 0, 0.5);
    margin-top: 2px;
}
.sp-summary__price {
    white-space: nowrap;
    font-weight: 600;
    font-size: 14px;
}
.sp-summary__empty {
    padding: 20px 8px;
    text-align: center;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.5);
    line-height: 1.5;
    font-style: italic;
}
.sp-summary__foot {
    border-top: 1px solid rgba(0, 0, 0, 0.08);
    padding: 16px 20px 18px;
    background: rgba(15, 118, 110, 0.04);
}
.sp-summary__row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 12px;
    color: rgba(0, 0, 0, 0.55);
    margin-bottom: 4px;
}
.sp-summary__row--discount {
    color: #166534;
}
.sp-summary__total {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-top: 6px;
}
.sp-summary__total-l {
    font-size: 14px;
    font-weight: 700;
}
.sp-summary__total-l small {
    display: block;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(0, 0, 0, 0.5);
    font-weight: 500;
    margin-top: 2px;
}
.sp-summary__total-r {
    font-size: 32px;
    font-weight: 800;
    color: var(--q-primary, #0f766e);
    letter-spacing: -0.02em;
    line-height: 1;
}
.sp-summary__savings {
    margin-top: 10px;
    padding: 8px 10px;
    background: rgba(22, 163, 74, 0.12);
    color: #166534;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
}
.sp-summary__cta {
    display: block;
    width: 100%;
    margin-top: 14px;
    padding: 14px 18px;
    background: var(--q-primary, #0f766e);
    color: #fff;
    border: none;
    border-radius: 14px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition: all 200ms;
}
.sp-summary__cta:hover:not(:disabled) {
    transform: translateY(-1px);
}
.sp-summary__cta:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
.sp-summary__disclaimer {
    margin-top: 12px;
    font-size: 11px;
    color: rgba(0, 0, 0, 0.5);
    line-height: 1.5;
    text-align: center;
}
</style>

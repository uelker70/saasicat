<template>
    <div class="sp-onb">
        <slot name="header" :pricing="draft.pricing.value">
            <header class="sp-onb__header">
                <div>
                    <div class="sp-onb__eyebrow">{{ i18n.eyebrow }}</div>
                    <h1>{{ i18n.title }}</h1>
                    <p>{{ i18n.subtitle }}</p>
                </div>
                <PlanCycleToggle
                    :model-value="draft.cycle.value"
                    :i18n="i18n.cycle"
                    @update:model-value="draft.setCycle"
                />
            </header>
        </slot>

        <div class="sp-onb__layout">
            <div class="sp-onb__main">
                <!-- ═══ Plan ═══ -->
                <section class="sp-onb__section">
                    <header class="sp-onb__sec-head">
                        <div class="sp-onb__sec-num">01 · {{ i18n.sections.plan.eyebrow }}</div>
                        <h2>{{ i18n.sections.plan.title }}</h2>
                        <p>{{ i18n.sections.plan.subtitle }}</p>
                    </header>
                    <PlanGrid
                        v-if="plans"
                        :model-value="draft.plan.value"
                        :plans="plans"
                        :cycle="draft.cycle.value"
                        :catalog-quota-keys="catalogQuotaKeys"
                        :current-plan-id="currentPlanId ?? null"
                        :format-currency="formatCurrency"
                        :format-quota-value="formatQuotaValue"
                        :quota-label="quotaLabel"
                        :i18n="i18n.plan"
                        @update:model-value="draft.setPlan"
                    />
                    <div v-else class="sp-onb__loading">{{ i18n.loading }}</div>
                </section>

                <!-- ═══ Bundles ═══ -->
                <section v-if="bookableSubscriptionBundles.length > 0" class="sp-onb__section">
                    <header class="sp-onb__sec-head">
                        <div class="sp-onb__sec-num">02 · {{ i18n.sections.bundles.eyebrow }}</div>
                        <h2>{{ i18n.sections.bundles.title }}</h2>
                        <p>{{ i18n.sections.bundles.subtitle }}</p>
                    </header>
                    <PublicBundleGrid
                        :bundles="bookableSubscriptionBundles"
                        :selected="draft.selectedBundleVersionIds.value"
                        :cycle="draft.cycle.value"
                        :plan-features="selectedPlanFeatures"
                        :format-currency="formatCurrency"
                        :feature-label="featureLabel"
                        :quota-label="quotaLabel"
                        :i18n="i18n.bundles"
                        @toggle="draft.toggleSubscriptionBundle"
                    />
                </section>

                <div class="sp-onb__actions">
                    <button v-if="onBack" type="button" class="sp-onb__back-btn" @click="onBack">
                        ← {{ i18n.back }}
                    </button>
                    <div v-if="submitError" class="sp-onb__error">{{ submitError }}</div>
                </div>
            </div>

            <PriceSummary
                :pricing="draft.pricing.value"
                :plan-name="draft.selectedPlan.value?.name ?? null"
                :format-currency="formatCurrency"
                :cta-label="submitting ? i18n.submitting : i18n.submit"
                :cta-disabled="submitting || !draft.plan.value"
                :i18n="i18n.summary"
                @submit="handleSubmit"
            >
                <template #promo-input>
                    <PromoCodeInput
                        v-if="enablePromo"
                        :model-value="draft.promoCode.value"
                        :state="draft.promoState.value"
                        :i18n="i18n.promo"
                        @update:model-value="draft.setPromoCode"
                        @apply="handleApplyPromo"
                        @remove="draft.clearPromo"
                    />
                </template>
            </PriceSummary>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import PlanCycleToggle from '../components/plan/PlanCycleToggle.vue';
import PlanGrid from '../components/plan/PlanGrid.vue';
import PublicBundleGrid from '../components/plan/PublicBundleGrid.vue';
import PromoCodeInput from '../components/plan/PromoCodeInput.vue';
import PriceSummary from '../components/plan/PriceSummary.vue';
import {
    useSubscriptionDraft,
    type PromoState,
    type SubscriptionDraft,
} from '../use-subscription-draft.js';
import type { CatalogPlan } from '../use-tenant-billing-catalog.js';
import type { BillingCycleStr } from '../use-tenant-billing.js';
import type {
    OnboardingSelectionRequest,
    OnboardingSelectionResponse,
    PromoPreviewRequest,
    PromoPreviewResponse,
    PublicMarketingBundle,
} from '@saasicat/types';

// OnboardingConfigurator — Page-Komponente für Tenant-Self-Service-Onboarding.
// Komponiert die Sub-Components, hält den Draft-State, ruft die Submit/Preview-
// Hooks des Konsumenten. Bewusst HTTP-frei: der Konsument injiziert
// `previewPromo()` + `submit()` über die Props (Axios-Wrapper o.ä.).

interface SectionI18n {
    eyebrow: string;
    title: string;
    subtitle: string;
}

interface OnboardingI18n {
    eyebrow: string;
    title: string;
    subtitle: string;
    loading: string;
    back: string;
    submit: string;
    submitting: string;
    sections: {
        plan: SectionI18n;
        bundles: SectionI18n;
    };
    cycle: { ariaLabel: string; monthly: string; yearly: string; savePill?: string };
    plan: {
        popular: string;
        current: string;
        perMonth: string;
        perYear: string;
        priceOnRequest: string;
    };
    bundles: {
        perMonth: string;
        perYear: string;
        empty: string;
        allPlans: string;
        priceOnRequest: string;
        /** Bundle vollständig durch Plan/andere Bundles gedeckt — nicht doppelt buchbar. */
        alreadyBooked: string;
        /** Präfix vor der Liste fehlender Voraussetzungs-Features. */
        missingRequires: string;
    };
    promo: { openLabel: string; placeholder: string; apply: string; remove: string };
    summary: {
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
        yearSavings: string;
        disclaimer?: string;
    };
    /** Wird aus dem Backend-Reason-String gemacht (`PromoPreviewInvalidReason` → Anzeige-Text). */
    promoReason: Record<string, string>;
}

const props = defineProps<{
    plans: CatalogPlan[] | null;
    /** Eigenständig buchbare Bundles aus `PublicMarketingCatalogResponse.bundles`. */
    availableBundles?: PublicMarketingBundle[];
    catalogQuotaKeys: string[];
    initialPlan?: string | null;
    initialCycle?: BillingCycleStr;
    currentPlanId?: string | null;
    enablePromo?: boolean;
    formatCurrency: (n: number) => string;
    formatQuotaValue: (key: string, value: number) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    /** Async-Hook für `POST /billing/promo/preview`. */
    previewPromo?: (req: PromoPreviewRequest) => Promise<PromoPreviewResponse>;
    /** Async-Hook für `POST /billing/onboarding/initial-subscription`. */
    submit: (payload: OnboardingSelectionRequest) => Promise<OnboardingSelectionResponse>;
    /** Optional: Zurück-Button-Handler. */
    onBack?: () => void;
    i18n: OnboardingI18n;
}>();

const emit = defineEmits<{
    submitted: [OnboardingSelectionResponse];
    error: [Error];
}>();

const subscriptionBundleOptions = computed(() => props.availableBundles ?? []);

const draft: SubscriptionDraft = useSubscriptionDraft({
    plans: computed(() => props.plans),
    subscriptionBundles: subscriptionBundleOptions,
    initialPlan: props.initialPlan ?? null,
    initialCycle: props.initialCycle ?? 'YEARLY',
});

const submitting = ref(false);
const submitError = ref<string | null>(null);

const selectedPlanFeatures = computed(() => draft.selectedPlan.value?.features ?? []);

const bookableSubscriptionBundles = computed(() => {
    const selectedPlan = draft.plan.value;
    return subscriptionBundleOptions.value.filter((bundle) => {
        if (bundle.monthlyNet === null && bundle.yearlyNet === null) return false;
        if (!selectedPlan) return true;
        return (
            bundle.compatiblePlanKeys.length === 0 ||
            bundle.compatiblePlanKeys.includes(selectedPlan)
        );
    });
});

async function handleApplyPromo(): Promise<void> {
    if (!props.previewPromo || !draft.promoCode.value || !draft.plan.value) return;
    draft.setPromoState({ status: 'checking', preview: null, message: '' });
    try {
        const res = await props.previewPromo({
            code: draft.promoCode.value,
            plan: draft.plan.value,
            billingCycle: draft.cycle.value,
        });
        if (res.valid) {
            draft.setPromoState({
                status: 'valid',
                preview: res,
                message: res.label,
            });
        } else {
            const reason = res.reason;
            const restricted = reason === 'BILLING_MISMATCH' || reason === 'PLAN_MISMATCH';
            draft.setPromoState({
                status: restricted ? 'restricted' : 'invalid',
                preview: res,
                message: props.i18n.promoReason[reason] ?? reason,
            });
        }
    } catch (err) {
        draft.setPromoState({
            status: 'invalid',
            preview: null,
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

async function handleSubmit(): Promise<void> {
    if (!draft.plan.value || submitting.value) return;
    submitting.value = true;
    submitError.value = null;
    try {
        const payload = draft.toApiPayload();
        const result = await props.submit(payload);
        emit('submitted', result);
    } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        submitError.value = e.message;
        emit('error', e);
    } finally {
        submitting.value = false;
    }
}

defineExpose({ draft });
</script>

<style scoped>
.sp-onb {
    padding: 28px 24px 80px;
    max-width: 1480px;
    margin: 0 auto;
}
.sp-onb__header {
    margin-bottom: 22px;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
}
.sp-onb__header > div:first-child {
    flex: 1 1 320px;
    min-width: 0;
}
.sp-onb__eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--q-primary, #0f766e);
    background: rgba(15, 118, 110, 0.08);
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid rgba(15, 118, 110, 0.2);
}
.sp-onb__header h1 {
    margin: 12px 0 8px;
    font-size: clamp(1.6rem, 3vw, 2.4rem);
    line-height: 1.1;
    letter-spacing: -0.01em;
}
.sp-onb__header p {
    margin: 0;
    color: rgba(0, 0, 0, 0.6);
    max-width: 640px;
}
.sp-onb__layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 24px;
    align-items: start;
}
@media (max-width: 1100px) {
    .sp-onb__layout {
        grid-template-columns: 1fr;
    }
}
.sp-onb__main {
    display: flex;
    flex-direction: column;
    gap: 20px;
}
.sp-onb__section {
    background: #fff;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 22px;
    padding: 26px 28px 24px;
    box-shadow: 0 24px 80px rgba(31, 41, 51, 0.05);
}
.sp-onb__sec-head {
    padding-bottom: 14px;
    margin-bottom: 18px;
    border-bottom: 1px dashed rgba(0, 0, 0, 0.08);
}
.sp-onb__sec-head h2 {
    margin: 6px 0 0;
    font-size: 1.4rem;
    letter-spacing: -0.005em;
}
.sp-onb__sec-head p {
    margin: 4px 0 0;
    color: rgba(0, 0, 0, 0.55);
    font-size: 13px;
    max-width: 520px;
}
.sp-onb__sec-num {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: 'SF Mono', Consolas, monospace;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--q-primary, #0f766e);
    font-weight: 700;
}
.sp-onb__sec-num::before {
    content: '';
    width: 28px;
    height: 1px;
    background: var(--q-primary, #0f766e);
}
.sp-onb__loading {
    padding: 40px;
    text-align: center;
    color: rgba(0, 0, 0, 0.5);
}
.sp-onb__actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding-top: 8px;
}
.sp-onb__back-btn {
    background: none;
    border: 1px solid rgba(0, 0, 0, 0.15);
    border-radius: 10px;
    padding: 10px 16px;
    font-family: inherit;
    font-size: 13px;
    cursor: pointer;
    color: rgba(0, 0, 0, 0.7);
}
.sp-onb__back-btn:hover {
    border-color: rgba(0, 0, 0, 0.4);
}
.sp-onb__error {
    color: #b91c1c;
    background: rgba(220, 38, 38, 0.08);
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
}
</style>

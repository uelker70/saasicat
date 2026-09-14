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
                    @update:model-value="chooseCycle"
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
                        @update:model-value="choosePlan"
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
                :cta-disabled="submitting || !draft.plan.value || !draft.pricing.value.planPriced"
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
import PlanCycleToggle from './plan/PlanCycleToggle.vue';
import PlanGrid from './plan/PlanGrid.vue';
import PublicBundleGrid from './plan/PublicBundleGrid.vue';
import PromoCodeInput from './plan/PromoCodeInput.vue';
import PriceSummary from './plan/PriceSummary.vue';
import { useSubscriptionDraft, type PromoState, type SubscriptionDraft } from '@saasicat/ui-vue';
import { latestAnswerWins } from './latest-answer-wins.js';
import type { CatalogPlan } from '@saasicat/ui-vue';
import type { BillingCycleStr } from '@saasicat/ui-vue';
import type {
    OnboardingSelectionRequest,
    OnboardingSelectionResponse,
    PromoPreviewRequest,
    PromoPreviewResponse,
    PublicMarketingBundle,
} from '@saasicat/core';

// OnboardingConfigurator — page component for tenant self-service onboarding.
// Composes the sub-components, holds the draft state, calls the consumer's
// submit/preview hooks. Deliberately HTTP-free: the consumer injects
// `previewPromo()` + `submit()` via the props (Axios wrapper or similar).

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
        /** A plan with a price in the other cycle only. */
        notSoldInCycle: string;
    };
    bundles: {
        perMonth: string;
        perYear: string;
        empty: string;
        allPlans: string;
        priceOnRequest: string;
        /** A bundle with a price in the other cycle only. */
        notSoldInCycle: string;
        /** Bundle fully covered by the plan/other bundles — not bookable twice. */
        alreadyBooked: string;
        /** Prefix before the list of missing prerequisite features. */
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
    /** Derived from the backend reason string (`PromoPreviewInvalidReason` → display text). */
    promoReason: Record<string, string>;
}

const props = defineProps<{
    plans: CatalogPlan[] | null;
    /** Independently bookable bundles from `PublicMarketingCatalogResponse.bundles`. */
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
    /** Async hook for `POST /billing/promo/preview`. */
    previewPromo?: (req: PromoPreviewRequest) => Promise<PromoPreviewResponse>;
    /** Async hook for `POST /billing/onboarding/initial-subscription`. */
    submit: (payload: OnboardingSelectionRequest) => Promise<OnboardingSelectionResponse>;
    /** Optional: back-button handler. */
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

// A preview answers for one plan and cycle, and the draft forgets it when either
// changes. A code the answer could differ for is asked about again rather than
// left for the tenant to notice that the discount disappeared: an applied one, a
// restricted one, or one still being checked. A code refused outright is not —
// another plan does not make it exist, and each question counts against the
// preview's rate limit.
function isWorthAskingAgain(): boolean {
    const status = draft.promoState.value.status;
    return status === 'valid' || status === 'restricted' || status === 'checking';
}

function choosePlan(planId: string): void {
    const askAgain = isWorthAskingAgain();
    draft.setPlan(planId);
    if (askAgain) void handleApplyPromo();
}

function chooseCycle(cycle: BillingCycleStr): void {
    const askAgain = isWorthAskingAgain();
    draft.setCycle(cycle);
    if (askAgain) void handleApplyPromo();
}

/** What the preview says about a code for a plan and cycle, as the draft holds it. */
async function previewPromoState(request: PromoPreviewRequest): Promise<PromoState> {
    if (!props.previewPromo) return { status: 'idle', preview: null, message: '' };
    try {
        const res = await props.previewPromo(request);
        if (res.valid) return { status: 'valid', preview: res, message: res.label };
        const reason = res.reason;
        const restricted = reason === 'BILLING_MISMATCH' || reason === 'PLAN_MISMATCH';
        return {
            status: restricted ? 'restricted' : 'invalid',
            preview: res,
            message: props.i18n.promoReason[reason] ?? reason,
        };
    } catch (err) {
        return {
            status: 'invalid',
            preview: null,
            message: err instanceof Error ? err.message : String(err),
        };
    }
}

// Only the answer to the current question lands. A tenant who switches the
// cycle twice would otherwise see whichever preview returned last, and one who
// edited or removed the code meanwhile — which leaves the draft no longer
// `checking` — the answer for a code they dropped.
const askPromoPreview = latestAnswerWins(previewPromoState, (state: PromoState) => {
    if (draft.promoState.value.status === 'checking') draft.setPromoState(state);
});

async function handleApplyPromo(): Promise<void> {
    if (!props.previewPromo || !draft.promoCode.value || !draft.plan.value) return;
    draft.setPromoState({ status: 'checking', preview: null, message: '' });
    await askPromoPreview({
        code: draft.promoCode.value,
        plan: draft.plan.value,
        billingCycle: draft.cycle.value,
    });
}

async function handleSubmit(): Promise<void> {
    // The button says the same, but a page replacing the summary's slot emits
    // `submit` without it.
    if (!draft.plan.value || !draft.pricing.value.planPriced || submitting.value) return;
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
    padding: var(--sa-space-7) var(--sa-space-7) var(--sa-space-11);
    max-width: 1480px;
    margin: 0 auto;
}
.sp-onb__header {
    margin-bottom: var(--sa-space-6);
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--sa-space-6);
}
.sp-onb__header > div:first-child {
    flex: 1 1 320px;
    min-width: 0;
}
.sp-onb__eyebrow {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-3);
    font-family: 'SF Mono', Consolas, monospace;
    font-size: var(--sa-text-xs);
    letter-spacing: var(--sa-tracking-wider);
    text-transform: uppercase;
    color: var(--sa-color-accent-strong);
    background: var(--sa-color-accent-surface);
    padding: var(--sa-space-2) var(--sa-space-4);
    border-radius: var(--sa-radius-pill);
    border: 1px solid var(--sa-color-accent-border);
}
.sp-onb__header h1 {
    margin: var(--sa-space-4) 0 var(--sa-space-3);
    font-size: var(--sa-text-4xl);
    line-height: 1.1;
    letter-spacing: var(--sa-tracking-normal);
}
.sp-onb__header p {
    margin: 0;
    color: var(--sa-color-fg-secondary);
    max-width: 640px;
}
.sp-onb__layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: var(--sa-space-7);
    align-items: start;
}
@media (max-width: 1023.98px) {
    .sp-onb__layout {
        grid-template-columns: 1fr;
    }
}
.sp-onb__main {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-6);
}
.sp-onb__section {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-hero);
    padding: var(--sa-space-7) var(--sa-space-7) var(--sa-space-7);
    box-shadow: 0 24px 80px var(--sa-shadow-tint-1);
}
.sp-onb__sec-head {
    padding-bottom: var(--sa-space-4);
    margin-bottom: var(--sa-space-5);
    border-bottom: 1px dashed var(--sa-color-border);
}
.sp-onb__sec-head h2 {
    margin: var(--sa-space-2) 0 0;
    font-size: var(--sa-text-2xl);
    letter-spacing: var(--sa-tracking-normal);
}
.sp-onb__sec-head p {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-md);
    max-width: 520px;
}
.sp-onb__sec-num {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-3);
    font-family: 'SF Mono', Consolas, monospace;
    font-size: var(--sa-text-xs);
    letter-spacing: var(--sa-tracking-wider);
    text-transform: uppercase;
    color: var(--sa-color-accent);
    font-weight: 700;
}
.sp-onb__sec-num::before {
    content: '';
    width: 28px;
    height: 1px;
    background: var(--sa-color-accent);
}
.sp-onb__loading {
    padding: var(--sa-space-9);
    text-align: center;
    color: var(--sa-color-fg-subtle);
}
.sp-onb__actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--sa-space-4);
    padding-top: var(--sa-space-3);
}
.sp-onb__back-btn {
    background: none;
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-tile);
    padding: var(--sa-space-3) var(--sa-space-5);
    font-family: inherit;
    font-size: var(--sa-text-md);
    cursor: pointer;
    color: var(--sa-color-fg-body);
}
.sp-onb__back-btn:hover {
    border-color: var(--sa-color-border-strong);
}
.sp-onb__error {
    color: var(--sa-color-negative-fg);
    background: var(--sa-color-negative-surface);
    padding: var(--sa-space-3) var(--sa-space-4);
    border-radius: var(--sa-radius-field);
    font-size: var(--sa-text-md);
}
</style>

<template>
    <TenantDialog
        v-model="model"
        :title="i18n.title"
        :subtitle="`${i18n.currentLabel}: ${currentPlanName} (${currentCycleLabel})`"
        size="lg"
        :close-label="i18n.close"
        persistent
    >
        <div class="sp-wizard__stepper">
            <ol class="sp-steps">
                <li
                    v-for="(entry, position) in stepHeadings"
                    :key="entry.step"
                    class="sp-steps__step"
                    :class="`sp-steps__step--${stepStatus(entry.step)}`"
                    :aria-current="stepStatus(entry.step) === 'current' ? 'step' : undefined"
                >
                    <span class="sp-steps__marker" aria-hidden="true">{{ position + 1 }}</span>
                    <span class="sp-steps__label">{{ entry.title }}</span>
                </li>
            </ol>

            <!-- Step 1: Plan + Cycle -->
            <section v-if="currentStep === 'choose'" class="sp-wizard__panel">
                <h3 ref="stepHeadingRef" v-bind="stepHeadingProps" class="sp-wizard__step-title">
                    {{ i18n.stepChoose }}
                </h3>
                <p class="sp-wizard__intro">{{ i18n.stepChooseIntro }}</p>

                <PlanCycleToggle
                    :model-value="targetCycle"
                    :i18n="cycleI18n"
                    class="sp-wizard__cycle"
                    @update:model-value="targetCycle = $event"
                />

                <PlanGrid
                    :model-value="targetPlan"
                    :plans="plans"
                    :cycle="targetCycle"
                    :catalog-quota-keys="catalogQuotaKeys"
                    :current-plan-id="currentPlanId"
                    :format-currency="formatCurrency"
                    :format-quota-value="formatQuotaValueResolved"
                    :quota-label="quotaLabel"
                    :i18n="planGridI18n"
                    @update:model-value="targetPlan = $event"
                />

                <div class="sp-wizard__nav">
                    <TenantButton variant="solid" tone="accent" @click="goToPreview">
                        {{ i18n.next }}
                    </TenantButton>
                </div>
            </section>

            <!-- Step 2: Preview -->
            <section v-else-if="currentStep === 'preview'" class="sp-wizard__panel">
                <h3 ref="stepHeadingRef" v-bind="stepHeadingProps" class="sp-wizard__step-title">
                    {{ i18n.stepPreview }}
                </h3>
                <div v-if="previewLoading" class="sp-wizard__loading">
                    <span class="sp-spinner" aria-hidden="true"></span>
                    <span>{{ i18n.previewLoading }}</span>
                </div>

                <div v-else-if="previewError" class="sp-wizard__error">
                    {{ previewError }}
                </div>

                <template v-else-if="preview">
                    <div class="sp-wizard__type">
                        <span class="sp-badge" :class="`sp-badge--${changeTypeTone}`">
                            {{ changeTypeLabel }}
                        </span>
                        <span v-if="preview.effectiveAt && !preview.isImmediate">
                            {{ i18n.effectiveAtLabel }}: {{ formatDate(preview.effectiveAt) }}
                        </span>
                        <span v-else-if="preview.isImmediate">
                            {{ i18n.effectiveImmediate }}
                        </span>
                    </div>

                    <div v-if="preview.proration" class="sp-wizard__proration">
                        <h4>{{ i18n.prorationTitle }}</h4>
                        <p>
                            {{ i18n.prorationLine }}
                            <strong>{{ formatCurrency(preview.proration.prorataDeltaNet) }}</strong>
                            ({{ preview.proration.daysRemainingInPeriod }} /
                            {{ preview.proration.daysInPeriod }} {{ i18n.prorationDays }})
                        </p>
                    </div>

                    <h4 class="sp-wizard__limits-title">{{ i18n.limitsTitle }}</h4>
                    <table class="sp-wizard__limits">
                        <thead>
                            <tr>
                                <th></th>
                                <th>{{ i18n.limitsUsed }}</th>
                                <th>{{ i18n.limitsCurrent }}</th>
                                <th>{{ i18n.limitsTarget }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            <LimitsRow
                                v-for="(row, key) in preview.limitsCheck"
                                :key="key"
                                :label="quotaLabel(String(key))"
                                :row="row"
                                :fractional="isFractionalQuotaSafe(String(key))"
                            />
                        </tbody>
                    </table>

                    <div v-if="preview.featuresGained.length > 0" class="sp-wizard__feat">
                        <h4>{{ i18n.featuresGained }}</h4>
                        <ul>
                            <li v-for="f in preview.featuresGained" :key="f">
                                {{ featureLabel(f) }}
                            </li>
                        </ul>
                    </div>

                    <div
                        v-if="preview.featuresLost.length > 0"
                        class="sp-wizard__feat sp-wizard__feat--warn"
                    >
                        <h4>{{ i18n.featuresLost }}</h4>
                        <ul>
                            <li v-for="f in preview.featuresLost" :key="f">
                                {{ featureLabel(f) }}
                            </li>
                        </ul>
                    </div>

                    <div v-if="preview.blockers.length > 0" class="sp-wizard__blockers">
                        <h4>{{ i18n.blockersTitle }}</h4>
                        <ul>
                            <li v-for="b in preview.blockers" :key="b.code">{{ b.message }}</li>
                        </ul>
                    </div>

                    <div v-if="preview.warnings.length > 0" class="sp-wizard__warnings">
                        <ul>
                            <li v-for="w in preview.warnings" :key="w.code">{{ w.message }}</li>
                        </ul>
                    </div>
                </template>

                <div class="sp-wizard__nav">
                    <TenantButton @click="goToPreviousStep()">{{ i18n.back }}</TenantButton>
                    <TenantButton
                        variant="solid"
                        tone="accent"
                        :disabled="!canAdvanceFromPreview"
                        @click="goToNextStep()"
                    >
                        {{ i18n.next }}
                    </TenantButton>
                </div>
            </section>

            <!-- Step 3: Confirm -->
            <section v-else class="sp-wizard__panel">
                <h3 ref="stepHeadingRef" v-bind="stepHeadingProps" class="sp-wizard__step-title">
                    {{ i18n.stepConfirm }}
                </h3>
                <p>
                    <strong>{{ targetPlanName }}</strong>
                    ({{ targetCycle === 'YEARLY' ? i18n.cycleYearly : i18n.cycleMonthly }})
                </p>
                <p v-if="preview?.isImmediate" class="sp-wizard__confirm-line">
                    {{ i18n.confirmImmediate }}
                </p>
                <p v-else-if="preview?.effectiveAt" class="sp-wizard__confirm-line">
                    {{ i18n.confirmScheduled }} {{ formatDate(preview.effectiveAt) }}.
                </p>

                <!-- #17: Price summary — prorated now + regular from the next period.
                         During a trial nothing is charged → only a note + next price. -->
                <div v-if="preview" class="sp-wizard__price-summary">
                    <h4>{{ i18n.confirmPriceTitle }}</h4>
                    <div v-if="isTrial" class="sp-wizard__price-note">
                        {{ i18n.confirmTrialNote }}
                    </div>
                    <div v-else-if="preview.proration" class="sp-wizard__price-row">
                        <span>{{ i18n.confirmProratedNow }}</span>
                        <strong>{{ formatCurrency(preview.proration.prorataDeltaNet) }}</strong>
                    </div>
                    <div class="sp-wizard__price-row">
                        <span>{{ recurringFromLabel }}</span>
                        <strong>
                            {{ formatCurrency(recurringPriceNet) }} {{ recurringCycleLabel }}
                        </strong>
                    </div>
                </div>

                <div v-if="submitError" class="sp-wizard__error sp-wizard__error--spaced">
                    {{ submitError }}
                </div>

                <div class="sp-wizard__nav">
                    <TenantButton :disabled="submitting" @click="goToPreviousStep()">
                        {{ i18n.back }}
                    </TenantButton>
                    <TenantButton
                        variant="solid"
                        tone="accent"
                        :loading="submitting"
                        @click="submit"
                    >
                        {{ submitting ? i18n.confirmInProgress : i18n.confirmAction }}
                    </TenantButton>
                </div>
            </section>
        </div>
    </TenantDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import LimitsRow from './LimitsRow.vue';
import PlanCycleToggle from './plan/PlanCycleToggle.vue';
import PlanGrid from './plan/PlanGrid.vue';
import TenantButton from './ui/TenantButton.vue';
import TenantDialog from './ui/TenantDialog.vue';
import './ui/tenant-ui.css';
import { useSteps, useSuperAdminI18n } from '@saasicat/ui-vue';
import type { BillingCycleStr, PlanChangePreviewShape } from '@saasicat/ui-vue';
import type { CatalogPlan } from '@saasicat/ui-vue';
import type { PlanChangeWizardI18n } from './default-i18n.js';

// PlanChangeWizard — 3-step dialog for plan changes.
//
// Input: list of bookable plans from the catalog + current plan/cycle.
// Logic: step 1 local selection, step 2 calls `previewPlanChange` and shows
// the limits check + proration + feature diff + blockers, step 3 calls `changePlan`.
// Data-driven via the passed `catalogQuotaKeys[]` — no hard-coded trinity.

interface Props {
    modelValue: boolean;
    plans: CatalogPlan[];
    currentPlanId: string;
    currentPlanName: string;
    currentCycle: BillingCycleStr;
    /** Subscription status (e.g. 'TRIAL'/'ACTIVE') — for the trial note in confirm. */
    currentStatus?: string;
    /** Trial-end ISO, if status is TRIAL — for "regular from the end of the trial". */
    trialEndsAt?: string | null;
    /** Catalog quota keys in declared order. */
    catalogQuotaKeys: string[];
    /** Consumer hooks. */
    formatCurrency: (n: number) => string;
    formatDate: (iso: string) => string;
    /**
     * Optional: combined label-+-value ("200 Mitglieder"). No longer used
     * internally since step 1 was switched to `<PlanGrid>` with `quotaLabel` +
     * `formatQuotaValue` (P10.2.1). Kept in the prop list for backward-
     * compatibility reasons — consumers that configured it earlier keep working
     * without any code change.
     */
    formatQuotaLabel?: (key: string, value: number) => string;
    /**
     * Plain value per quota key, e.g. "200" or "10 GB" (for PlanGrid).
     * Optional — default: takes `value.toLocaleString()` in the active UI
     * locale, appends a `GB` suffix for `storage` keys, replaces -1 with ∞.
     */
    formatQuotaValue?: (key: string, value: number) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    isFractionalQuota?: (key: string) => boolean;
    /** Preview caller (passed through from the consumer composable). */
    previewPlanChange: (plan: string, cycle: BillingCycleStr) => Promise<PlanChangePreviewShape>;
    changePlan: (plan: string, cycle: BillingCycleStr, immediate: boolean) => Promise<void>;
    i18n: PlanChangeWizardI18n;
}

const props = defineProps<Props>();
const emit = defineEmits<{
    'update:modelValue': [boolean];
    submitted: [];
}>();

const { intlLocale } = useSuperAdminI18n();

const model = computed({
    get: () => props.modelValue,
    set: (v) => emit('update:modelValue', v),
});

const WIZARD_STEPS = ['choose', 'preview', 'confirm'] as const;
type WizardStep = (typeof WIZARD_STEPS)[number];

const targetPlan = ref<string | null>(null);
const targetCycle = ref<BillingCycleStr>(props.currentCycle);

const preview = ref<PlanChangePreviewShape | null>(null);
const previewLoading = ref(false);
const previewError = ref<string | null>(null);

const submitting = ref(false);
const submitError = ref<string | null>(null);

const currentCycleLabel = computed(() =>
    props.currentCycle === 'YEARLY' ? props.i18n.cycleYearly : props.i18n.cycleMonthly,
);

const targetPlanName = computed(() => {
    if (!targetPlan.value) return '';
    return props.plans.find((p) => p.id === targetPlan.value)?.name ?? targetPlan.value;
});

const canAdvanceFromStep1 = computed(() => {
    if (!targetPlan.value) return false;
    return targetPlan.value !== props.currentPlanId || targetCycle.value !== props.currentCycle;
});

// #17 — price summary in the confirm step: regular price from the next period
// (in the selected cycle) + possibly the prorated amount due for the current period.
const recurringPriceNet = computed<number>(() => {
    const t = preview.value?.target.plan;
    if (!t) return 0;
    return (targetCycle.value === 'YEARLY' ? t.yearlyNet : t.monthlyNet) ?? 0;
});

const recurringCycleLabel = computed(() =>
    targetCycle.value === 'YEARLY' ? props.i18n.perCycleYearly : props.i18n.perCycleMonthly,
);

const isTrial = computed(() => props.currentStatus === 'TRIAL');

const recurringFromLabel = computed(() => {
    // Trial: nothing due during the trial → regular only from the end of the trial.
    // Prefers the projected NEW trial end (carry-over), otherwise the current one.
    if (isTrial.value) {
        const end =
            preview.value?.projectedTrialEndsAt ??
            props.trialEndsAt ??
            preview.value?.effectiveAt ??
            null;
        return end
            ? `${props.i18n.confirmRecurringTrialEnd} (${props.formatDate(end)})`
            : props.i18n.confirmRecurringTrialEnd;
    }
    // Immediately effective (upgrade without trial): regular from the next period.
    if (preview.value?.proration) return props.i18n.confirmRecurringNext;
    // Scheduled (downgrade/cycle): regular from the effective date.
    if (preview.value?.effectiveAt) {
        return `${props.i18n.confirmRecurringFrom} ${props.formatDate(preview.value.effectiveAt)}`;
    }
    return props.i18n.confirmRecurringNext;
});

const canAdvanceFromPreview = computed(
    () => !!preview.value && preview.value.blockers.length === 0,
);

// One guard for both the button and the move: `useSteps` reads the same
// predicates that disable the buttons, so the two cannot drift into a button
// that enables while the move refuses. Declared below them on purpose — a
// closure over a `const` that is not yet initialised is a trap waiting for the
// first render that reaches the later branch.
const {
    current: currentStep,
    statusOf: stepStatus,
    headingRef: stepHeadingRef,
    headingProps: stepHeadingProps,
    next: goToNextStep,
    back: goToPreviousStep,
    reset: resetSteps,
} = useSteps<WizardStep>({
    steps: WIZARD_STEPS,
    canLeave: (step) => {
        if (step === 'choose') return canAdvanceFromStep1.value;
        if (step === 'preview') return canAdvanceFromPreview.value;
        return true;
    },
});

const stepHeadings = computed(() => [
    { step: 'choose' as const, title: props.i18n.stepChoose },
    { step: 'preview' as const, title: props.i18n.stepPreview },
    { step: 'confirm' as const, title: props.i18n.stepConfirm },
]);

const changeTypeLabel = computed(() => {
    if (!preview.value) return '';
    switch (preview.value.changeType) {
        case 'UPGRADE':
            return props.i18n.changeTypeUpgrade;
        case 'DOWNGRADE':
            return props.i18n.changeTypeDowngrade;
        case 'CYCLE_CHANGE':
            return props.i18n.changeTypeCycle;
        default:
            return props.i18n.changeTypeNoop;
    }
});

// A tone from the badge's own vocabulary, not a Quasar colour name. The two
// happened to spell four of five the same way; `grey` did not, and a name that
// is right by coincidence is the kind that breaks quietly.
const changeTypeTone = computed(() => {
    if (!preview.value) return 'neutral';
    switch (preview.value.changeType) {
        case 'UPGRADE':
            return 'positive';
        case 'DOWNGRADE':
            return 'negative';
        case 'CYCLE_CHANGE':
            return 'info';
        default:
            return 'neutral';
    }
});

function isFractionalQuotaSafe(key: string): boolean {
    return props.isFractionalQuota?.(key) ?? key.toLowerCase().includes('storage');
}

function formatQuotaValueResolved(key: string, value: number | null | undefined): string {
    if (props.formatQuotaValue) return props.formatQuotaValue(key, value as number);
    // Plans may omit individual quota keys; the default renderer must
    // cope with `undefined` instead of crashing (.toLocaleString).
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    if (value < 0) return '∞';
    if (key.toLowerCase().includes('storage')) return `${value} GB`;
    return value.toLocaleString(intlLocale.value);
}

const cycleI18n = computed(() => ({
    ariaLabel: props.i18n.cycleMonthly + ' / ' + props.i18n.cycleYearly,
    monthly: props.i18n.cycleMonthly,
    yearly: props.i18n.cycleYearly,
}));

const planGridI18n = computed(() => ({
    popular: props.i18n.badgePopular,
    current: props.i18n.badgeCurrent,
    perMonth: props.i18n.priceUnitMonthly,
    perYear: props.i18n.priceUnitYearly,
    priceOnRequest: props.i18n.priceOnRequest,
}));

async function goToPreview() {
    const plan = targetPlan.value;
    // The step guard is the authority on whether this move may happen — it
    // reads the same predicate that disabled the button. The null check beside
    // it says the same thing to the compiler, which cannot see through the
    // guard.
    if (!plan || !goToNextStep()) return;
    previewLoading.value = true;
    previewError.value = null;
    try {
        preview.value = await props.previewPlanChange(plan, targetCycle.value);
    } catch (err) {
        preview.value = null;
        previewError.value = err instanceof Error ? err.message : String(err);
    } finally {
        previewLoading.value = false;
    }
}

async function submit() {
    if (!targetPlan.value || !preview.value) return;
    submitting.value = true;
    submitError.value = null;
    try {
        await props.changePlan(targetPlan.value, targetCycle.value, preview.value.isImmediate);
        emit('submitted');
        close();
    } catch (err) {
        submitError.value = err instanceof Error ? err.message : String(err);
    } finally {
        submitting.value = false;
    }
}

function close() {
    model.value = false;
    // Reset state so the next open starts fresh.
    setTimeout(() => {
        resetSteps();
        targetPlan.value = null;
        targetCycle.value = props.currentCycle;
        preview.value = null;
        previewError.value = null;
        submitError.value = null;
    }, 200);
}

watch(
    () => props.modelValue,
    (v) => {
        if (v) {
            targetCycle.value = props.currentCycle;
        }
    },
);
</script>

<style scoped>
/* CSS vars for light + dark mode */
.sp-wizard__stepper {
    --sp-wiz-border: var(--sa-color-border);
    --sp-wiz-text-strong: var(--sa-color-fg-heading);
    --sp-wiz-text-muted: var(--sa-color-fg-secondary);
    --sp-wiz-text-faint: var(--sa-color-fg-muted);
    --sp-wiz-border-soft: var(--sa-color-border-soft);
}
/* The progress list. A list, not a set of controls: Quasar's header was only
 * navigable under `header-nav`, which this wizard never set. */
.sp-steps {
    display: flex;
    align-items: center;
    gap: var(--sa-space-5);
    flex-wrap: wrap;
    list-style: none;
    margin: 0 0 var(--sa-space-6);
    padding: 0 0 var(--sa-space-5);
    border-bottom: 1px solid var(--sp-wiz-border);
}
.sp-steps__step {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    font-size: var(--sa-text-md);
    color: var(--sp-wiz-text-faint);
}
.sp-steps__marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-pill);
    font-size: var(--sa-text-sm);
    font-weight: 600;
}
/* The state is carried by weight and a mark as well as by colour — a step list
 * that says "you are here" only in blue says it to nobody who cannot see blue. */
.sp-steps__step--current {
    color: var(--sa-color-fg-heading);
    font-weight: 600;
}
.sp-steps__step--current .sp-steps__marker {
    background: var(--sa-color-accent);
    border-color: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
}
.sp-steps__step--done {
    color: var(--sa-color-fg-secondary);
}
.sp-steps__step--done .sp-steps__marker {
    background: var(--sa-color-positive-surface);
    border-color: var(--sa-color-positive-border);
    color: var(--sa-color-positive-fg);
}
.sp-wizard__step-title {
    margin: 0 0 var(--sa-space-4);
    font-size: var(--sa-text-lg);
    font-weight: 600;
    color: var(--sp-wiz-text-strong);
}
.sp-wizard__step-title:focus-visible {
    outline: 2px solid var(--sa-color-border-focus);
    outline-offset: 2px;
}
.sp-wizard__cycle {
    margin-bottom: var(--sa-space-5);
}
.sp-wizard__nav {
    display: flex;
    justify-content: flex-end;
    gap: var(--sa-space-3);
    margin-top: var(--sa-space-7);
}
.sp-wizard__limits-title {
    margin-top: var(--sa-space-7);
}
.sp-wizard__error--spaced {
    margin-top: var(--sa-space-5);
}
.sp-wizard__intro {
    color: var(--sp-wiz-text-muted);
    margin-bottom: var(--sa-space-5);
}
.sp-wizard__loading {
    display: flex;
    gap: var(--sa-space-4);
    align-items: center;
    padding: var(--sa-space-7) 0;
}
.sp-wizard__error {
    color: var(--sa-color-negative);
    background: var(--sa-color-negative-surface);
    padding: var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
}
.sp-wizard__type {
    margin-bottom: var(--sa-space-4);
}
.sp-wizard__proration {
    background: var(--sa-color-info-surface);
    padding: var(--sa-space-4) var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
    margin-top: var(--sa-space-4);
}
.sp-wizard__proration h4 {
    margin: 0 0 var(--sa-space-2);
    font-size: var(--sa-text-lg);
}
.sp-wizard__proration p {
    margin: 0;
}
.sp-wizard__limits {
    width: 100%;
    border-collapse: collapse;
    margin-top: var(--sa-space-2);
}
.sp-wizard__limits thead th {
    padding: var(--sa-space-2) var(--sa-space-4);
    text-align: left;
    font-size: var(--sa-text-sm);
    color: var(--sp-wiz-text-faint);
    text-transform: uppercase;
    border-bottom: 1px solid var(--sp-wiz-border-soft);
}
.sp-wizard__feat,
.sp-wizard__blockers,
.sp-wizard__warnings {
    margin-top: var(--sa-space-5);
}
.sp-wizard__feat h4,
.sp-wizard__blockers h4 {
    margin: 0 0 var(--sa-space-2);
    font-size: var(--sa-text-lg);
}
.sp-wizard__feat--warn {
    color: var(--sa-color-negative);
}
.sp-wizard__blockers {
    color: var(--sa-color-negative);
    background: var(--sa-color-negative-surface);
    padding: var(--sa-space-4) var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
}
.sp-wizard__warnings {
    color: var(--sa-color-warning);
    font-size: var(--sa-text-md);
}
.sp-wizard__confirm-line {
    color: var(--sp-wiz-text-muted);
}
.sp-wizard__price-summary {
    margin-top: var(--sa-space-5);
    background: var(--sa-color-info-surface);
    padding: var(--sa-space-4) var(--sa-space-4);
    border-radius: var(--sa-radius-badge);
}
.sp-wizard__price-summary h4 {
    margin: 0 0 var(--sa-space-3);
    font-size: var(--sa-text-lg);
}
.sp-wizard__price-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--sa-space-5);
    padding: var(--sa-space-1) 0;
}
.sp-wizard__price-note {
    color: var(--sp-wiz-text-muted);
    padding: var(--sa-space-1) 0 var(--sa-space-2);
}
</style>

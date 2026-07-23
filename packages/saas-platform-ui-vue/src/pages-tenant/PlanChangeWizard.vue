<template>
    <q-dialog v-model="model" persistent>
        <q-card class="sp-wizard">
            <q-card-section class="sp-wizard__head">
                <div>
                    <div class="sp-wizard__title">{{ i18n.title }}</div>
                    <div class="sp-wizard__sub">
                        {{ i18n.currentLabel }}: {{ currentPlanName }} ({{ currentCycleLabel }})
                    </div>
                </div>
                <q-btn flat round dense icon="close" :aria-label="i18n.close" @click="close" />
            </q-card-section>

            <q-stepper
                v-model="step"
                animated
                flat
                keep-alive
                active-color="primary"
                class="sp-wizard__stepper"
            >
                <!-- Step 1: Plan + Cycle -->
                <q-step :name="1" :title="i18n.stepChoose" icon="grade" :done="step > 1">
                    <p class="sp-wizard__intro">{{ i18n.stepChooseIntro }}</p>

                    <PlanCycleToggle
                        :model-value="targetCycle"
                        :i18n="cycleI18n"
                        class="q-mb-md"
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

                    <q-stepper-navigation>
                        <q-btn
                            color="primary"
                            :label="i18n.next"
                            :disable="!targetPlan || !canAdvanceFromStep1"
                            unelevated
                            @click="goToPreview"
                        />
                    </q-stepper-navigation>
                </q-step>

                <!-- Step 2: Preview -->
                <q-step :name="2" :title="i18n.stepPreview" icon="preview" :done="step > 2">
                    <div v-if="previewLoading" class="sp-wizard__loading">
                        <q-spinner size="32px" />
                        <span>{{ i18n.previewLoading }}</span>
                    </div>

                    <div v-else-if="previewError" class="sp-wizard__error">
                        {{ previewError }}
                    </div>

                    <template v-else-if="preview">
                        <div class="sp-wizard__type">
                            <q-badge
                                :color="changeTypeColor"
                                :label="changeTypeLabel"
                                class="q-mr-sm"
                            />
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
                                <strong>{{
                                    formatCurrency(preview.proration.prorataDeltaNet)
                                }}</strong>
                                ({{ preview.proration.daysRemainingInPeriod }} /
                                {{ preview.proration.daysInPeriod }} {{ i18n.prorationDays }})
                            </p>
                        </div>

                        <h4 class="q-mt-lg">{{ i18n.limitsTitle }}</h4>
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

                    <q-stepper-navigation>
                        <q-btn flat :label="i18n.back" @click="step = 1" />
                        <q-btn
                            color="primary"
                            :label="i18n.next"
                            unelevated
                            class="q-ml-sm"
                            :disable="!canAdvanceFromPreview"
                            @click="step = 3"
                        />
                    </q-stepper-navigation>
                </q-step>

                <!-- Step 3: Confirm -->
                <q-step :name="3" :title="i18n.stepConfirm" icon="check_circle">
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

                    <div v-if="submitError" class="sp-wizard__error q-mt-md">
                        {{ submitError }}
                    </div>

                    <q-stepper-navigation>
                        <q-btn flat :label="i18n.back" @click="step = 2" />
                        <q-btn
                            color="primary"
                            :label="submitting ? i18n.confirmInProgress : i18n.confirmAction"
                            unelevated
                            class="q-ml-sm"
                            :loading="submitting"
                            :disable="submitting"
                            @click="submit"
                        />
                    </q-stepper-navigation>
                </q-step>
            </q-stepper>
        </q-card>
    </q-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import LimitsRow from './LimitsRow.vue';
import PlanCycleToggle from '../components/plan/PlanCycleToggle.vue';
import PlanGrid from '../components/plan/PlanGrid.vue';
import { useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import type { BillingCycleStr, PlanChangePreviewShape } from '../vue/use-tenant-billing.js';
import type { CatalogPlan } from '../vue/use-tenant-billing-catalog.js';

// PlanChangeWizard — 3-step dialog for plan changes.
//
// Input: list of bookable plans from the catalog + current plan/cycle.
// Logic: step 1 local selection, step 2 calls `previewPlanChange` and shows
// the limits check + proration + feature diff + blockers, step 3 calls `changePlan`.
// Data-driven via the passed `catalogQuotaKeys[]` — no hard-coded trinity.

interface I18nStrings {
    title: string;
    close: string;
    currentLabel: string;
    cycleMonthly: string;
    cycleYearly: string;
    badgeCurrent: string;
    badgePopular: string;
    priceUnitMonthly: string;
    priceUnitYearly: string;
    priceOnRequest: string;
    stepChoose: string;
    stepChooseIntro: string;
    stepPreview: string;
    stepConfirm: string;
    next: string;
    back: string;
    previewLoading: string;
    effectiveAtLabel: string;
    effectiveImmediate: string;
    prorationTitle: string;
    prorationLine: string;
    prorationDays: string;
    limitsTitle: string;
    limitsUsed: string;
    limitsCurrent: string;
    limitsTarget: string;
    featuresGained: string;
    featuresLost: string;
    blockersTitle: string;
    confirmImmediate: string;
    confirmScheduled: string;
    confirmAction: string;
    confirmInProgress: string;
    confirmPriceTitle: string;
    confirmProratedNow: string;
    confirmRecurringNext: string;
    confirmRecurringFrom: string;
    perCycleMonthly: string;
    perCycleYearly: string;
    confirmTrialNote: string;
    confirmRecurringTrialEnd: string;
    changeTypeUpgrade: string;
    changeTypeDowngrade: string;
    changeTypeCycle: string;
    changeTypeNoop: string;
}

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
    i18n: I18nStrings;
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

const step = ref(1);
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

const changeTypeColor = computed(() => {
    if (!preview.value) return 'grey';
    switch (preview.value.changeType) {
        case 'UPGRADE':
            return 'positive';
        case 'DOWNGRADE':
            return 'negative';
        case 'CYCLE_CHANGE':
            return 'info';
        default:
            return 'grey';
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
    if (!targetPlan.value) return;
    step.value = 2;
    previewLoading.value = true;
    previewError.value = null;
    try {
        preview.value = await props.previewPlanChange(targetPlan.value, targetCycle.value);
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
        step.value = 1;
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
.sp-wizard {
    width: min(900px, 95vw);
    max-height: 90vh;
}
/* CSS vars for light + dark mode */
.sp-wizard {
    --sp-wiz-border: rgba(0, 0, 0, 0.08);
    --sp-wiz-text-strong: rgba(0, 0, 0, 0.87);
    --sp-wiz-text-muted: rgba(0, 0, 0, 0.6);
    --sp-wiz-text-faint: rgba(0, 0, 0, 0.55);
    --sp-wiz-border-soft: rgba(0, 0, 0, 0.1);
}
:global(.body--dark) .sp-wizard {
    --sp-wiz-border: rgba(255, 255, 255, 0.12);
    --sp-wiz-text-strong: rgba(255, 255, 255, 0.92);
    --sp-wiz-text-muted: rgba(255, 255, 255, 0.7);
    --sp-wiz-text-faint: rgba(255, 255, 255, 0.6);
    --sp-wiz-border-soft: rgba(255, 255, 255, 0.18);
}
.sp-wizard__head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 1px solid var(--sp-wiz-border);
}
.sp-wizard__title {
    font-size: 18px;
    font-weight: 600;
    color: var(--sp-wiz-text-strong);
}
.sp-wizard__sub {
    color: var(--sp-wiz-text-muted);
    font-size: 13px;
}
.sp-wizard__intro {
    color: var(--sp-wiz-text-muted);
    margin-bottom: 16px;
}
.sp-wizard__loading {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 24px 0;
}
.sp-wizard__error {
    color: var(--q-negative, #c10015);
    background: rgba(193, 0, 21, 0.08);
    padding: 12px;
    border-radius: 4px;
}
.sp-wizard__type {
    margin-bottom: 12px;
}
.sp-wizard__proration {
    background: rgba(25, 118, 210, 0.06);
    padding: 12px 14px;
    border-radius: 4px;
    margin-top: 12px;
}
.sp-wizard__proration h4 {
    margin: 0 0 6px;
    font-size: 14px;
}
.sp-wizard__proration p {
    margin: 0;
}
.sp-wizard__limits {
    width: 100%;
    border-collapse: collapse;
    margin-top: 4px;
}
.sp-wizard__limits thead th {
    padding: 6px 12px;
    text-align: left;
    font-size: 12px;
    color: var(--sp-wiz-text-faint);
    text-transform: uppercase;
    border-bottom: 1px solid var(--sp-wiz-border-soft);
}
.sp-wizard__feat,
.sp-wizard__blockers,
.sp-wizard__warnings {
    margin-top: 16px;
}
.sp-wizard__feat h4,
.sp-wizard__blockers h4 {
    margin: 0 0 6px;
    font-size: 14px;
}
.sp-wizard__feat--warn {
    color: rgba(193, 0, 21, 0.8);
}
.sp-wizard__blockers {
    color: var(--q-negative, #c10015);
    background: rgba(193, 0, 21, 0.06);
    padding: 12px 14px;
    border-radius: 4px;
}
.sp-wizard__warnings {
    color: var(--q-warning, #c87b00);
    font-size: 13px;
}
.sp-wizard__confirm-line {
    color: var(--sp-wiz-text-muted);
}
.sp-wizard__price-summary {
    margin-top: 16px;
    background: rgba(25, 118, 210, 0.06);
    padding: 12px 14px;
    border-radius: 4px;
}
.sp-wizard__price-summary h4 {
    margin: 0 0 8px;
    font-size: 14px;
}
.sp-wizard__price-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    padding: 2px 0;
}
.sp-wizard__price-note {
    color: var(--sp-wiz-text-muted);
    padding: 2px 0 6px;
}
</style>

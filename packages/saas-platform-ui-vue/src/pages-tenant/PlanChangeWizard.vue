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

                    <!-- #17: Preisübersicht — anteilig jetzt + regulär ab Folgeperiode.
                         Im Trial fällt nichts an → nur Hinweis + Folgepreis. -->
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
import type { BillingCycleStr, PlanChangePreviewShape } from '../use-tenant-billing.js';
import type { CatalogPlan } from '../use-tenant-billing-catalog.js';

// PlanChangeWizard — 3-Step-Dialog für Plan-Wechsel.
//
// Eingabe: Liste der buchbaren Pläne aus dem Catalog + aktueller Plan/Cycle.
// Logik: Step 1 lokale Auswahl, Step 2 ruft `previewPlanChange` und zeigt
// Limits-Check + Proration + Feature-Diff + Blockers, Step 3 ruft `changePlan`.
// Datengetrieben über die übergebenen `catalogQuotaKeys[]` — keine harte Trinität.

interface I18nStrings {
    title: string;
    close: string;
    currentLabel: string;
    cycleMonthly: string;
    cycleYearly: string;
    badgeCurrent: string;
    badgePopular: string;
    priceUnitMonthly: string;
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
    /** Subscription-Status (z. B. 'TRIAL'/'ACTIVE') — für Trial-Hinweis im Confirm. */
    currentStatus?: string;
    /** Trial-Ende-ISO, falls Status TRIAL — für „regulär ab Ende der Testphase". */
    trialEndsAt?: string | null;
    /** Catalog-Quota-Keys in deklarierter Reihenfolge. */
    catalogQuotaKeys: string[];
    /** Konsumenten-Hooks. */
    formatCurrency: (n: number) => string;
    formatDate: (iso: string) => string;
    /**
     * Optional: kombinierter Label-+-Wert ("200 Mitglieder"). Wird intern
     * nicht mehr benutzt, seit Step 1 auf `<PlanGrid>` mit `quotaLabel` +
     * `formatQuotaValue` umgestellt ist (P10.2.1). Bleibt aus Backward-
     * Kompatibilitätsgründen in der Prop-Liste — Konsumenten, die ihn früher
     * konfiguriert haben, funktionieren ohne Code-Änderung weiter.
     */
    formatQuotaLabel?: (key: string, value: number) => string;
    /**
     * Reiner Wert pro Quota-Key, z. B. "200" oder "10 GB" (für PlanGrid).
     * Optional — Default: nimmt `value.toLocaleString('de-DE')`, fügt bei
     * `storage`-Keys eine `GB`-Endung an, ersetzt -1 durch ∞.
     */
    formatQuotaValue?: (key: string, value: number) => string;
    quotaLabel: (key: string) => string;
    featureLabel: (key: string) => string;
    isFractionalQuota?: (key: string) => boolean;
    /** Preview-Caller (vom Konsumenten-Composable durchgereicht). */
    previewPlanChange: (plan: string, cycle: BillingCycleStr) => Promise<PlanChangePreviewShape>;
    changePlan: (plan: string, cycle: BillingCycleStr, immediate: boolean) => Promise<void>;
    i18n: I18nStrings;
}

const props = defineProps<Props>();
const emit = defineEmits<{
    'update:modelValue': [boolean];
    submitted: [];
}>();

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

// #17 — Preisübersicht im Bestätigen-Schritt: regulärer Preis ab Folgeperiode
// (im gewählten Zyklus) + ggf. anteilig fälliger Betrag der laufenden Periode.
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
    // Trial: während Testphase nichts fällig → regulär erst ab Testphasen-Ende.
    // Bevorzugt das projizierte NEUE Trial-Ende (Carry-over), sonst das aktuelle.
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
    // Sofort wirksam (Upgrade ohne Trial): regulär ab nächster Periode.
    if (preview.value?.proration) return props.i18n.confirmRecurringNext;
    // Geplant (Downgrade/Cycle): regulär ab Wirksamkeitsdatum.
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
    // Plans dürfen einzelne Quota-Keys weglassen; Default-Renderer muss
    // mit `undefined` zurechtkommen statt zu crashen (.toLocaleString).
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    if (value < 0) return '∞';
    if (key.toLowerCase().includes('storage')) return `${value} GB`;
    return value.toLocaleString('de-DE');
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
    perYear: props.i18n.priceUnitMonthly,
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
    // Reset State, damit der nächste Open-Vorgang frisch startet.
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
/* CSS-Vars für Light + Dark Mode */
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

<template>
    <div class="bve">
        <BundleStatusBanner :version="version" :now="now" @discard="$emit('discard')" />

        <div v-if="hasOverlap" class="bve-overlap-banner" role="alert">
            <span class="bve-overlap-ico">⚠</span>
            <span>
                <b>{{ overlapPlansCount }}</b>
                {{ overlapPlansCount === 1 ? msg.editor.overlapOne : msg.editor.overlapMany }}
            </span>
        </div>

        <div class="bve-grid">
            <!-- LEFT: Features + Quotas -->
            <section class="bve-col">
                <div class="bve-section-label">
                    <span>{{ msg.editor.sectionFeatures }}</span>
                    <span class="bve-section-count">
                        {{ form.features.length }} / {{ availableFeatures.length }}
                    </span>
                </div>
                <BundleFeaturesEditor
                    :available-features="availableFeatures"
                    :features="form.features"
                    :locked="locked"
                    :feature-registry="featureRegistry"
                    :overlap-keys="aggregatedOverlapFeatures"
                    @toggle="onToggleFeature"
                />

                <div class="bve-section-label bve-section-label--top">
                    <span>{{ msg.fields.quotas }}</span>
                    <span class="bve-section-count">
                        {{ Object.keys(form.quotas).length }} / {{ availableQuotas.length }}
                    </span>
                </div>
                <BundleQuotasEditor
                    :available-quotas="availableQuotas"
                    :quotas="form.quotas"
                    :locked="locked"
                    :overlap-keys="aggregatedOverlapQuotas"
                    :quota-registry="quotaRegistry"
                    @toggle="onToggleQuota"
                    @set-value="onSetQuotaValue"
                />
            </section>

            <!-- RIGHT: Pricing · Validity · Compat -->
            <section class="bve-col">
                <div class="bve-section-label">
                    <span>{{ msg.editor.sectionPricing }}</span>
                    <span class="bve-section-count">{{ msg.editor.pricingHint }}</span>
                </div>
                <div class="bve-row bve-row--pricing">
                    <label class="bve-field">
                        <span class="bve-field-label">{{ msg.fields.monthlyPrice }}</span>
                        <div class="bve-input-grp">
                            <input
                                type="text"
                                inputmode="decimal"
                                class="bve-input"
                                :value="form.monthlyNet ?? ''"
                                :disabled="locked"
                                @input="onPriceInput('monthlyNet', $event)"
                            />
                            <span class="bve-input-unit">{{ msg.fields.perMonthUnit }}</span>
                        </div>
                    </label>
                    <label class="bve-field">
                        <span class="bve-field-label">{{ msg.fields.yearlyPrice }}</span>
                        <div class="bve-input-grp">
                            <input
                                type="text"
                                inputmode="decimal"
                                class="bve-input"
                                :value="form.yearlyNet ?? ''"
                                :disabled="locked"
                                @input="onPriceInput('yearlyNet', $event)"
                            />
                            <span class="bve-input-unit">{{ msg.fields.perYearUnit }}</span>
                        </div>
                    </label>
                    <div class="bve-savings">
                        <template v-if="savingsPercent !== null">
                            {{ yearlyEquivalentText }}
                            <span v-if="savingsPercent > 0" class="bve-savings-pill">
                                {{ savingsText }}
                            </span>
                        </template>
                    </div>
                </div>

                <div class="bve-section-label bve-section-label--top">
                    <span>{{ common.validity }}</span>
                    <span class="bve-section-count">{{ msg.editor.validityHint }}</span>
                </div>
                <div class="bve-row bve-row--validity">
                    <label class="bve-field">
                        <span class="bve-field-label">{{ msg.fields.validFrom }}</span>
                        <input
                            type="date"
                            class="bve-input"
                            :value="form.validFrom ?? ''"
                            :disabled="locked"
                            @input="onValidFromInput"
                        />
                    </label>
                    <label class="bve-field">
                        <span class="bve-field-label">{{ msg.fields.validUntil }}</span>
                        <input
                            type="text"
                            class="bve-input bve-input--readonly"
                            :value="validUntilDisplay"
                            disabled
                        />
                        <span class="bve-field-hint">{{ msg.editor.validUntilHint }}</span>
                    </label>
                </div>

                <div class="bve-section-label bve-section-label--top">
                    <span>{{ msg.editor.sectionMarketing }}</span>
                </div>
                <label class="bve-toggle-row">
                    <input
                        type="checkbox"
                        :checked="form.marketed"
                        :disabled="locked"
                        @change="onMarketedToggle"
                    />
                    <span class="bve-toggle-label">{{ msg.editor.marketed }}</span>
                </label>

                <div class="bve-section-label bve-section-label--top">
                    <span>{{ msg.editor.sectionChangeNote }}</span>
                    <span class="bve-section-count">{{ msg.editor.changeNoteRequired }}</span>
                </div>
                <textarea
                    class="bve-textarea"
                    rows="2"
                    :value="form.changeNote"
                    :disabled="locked"
                    :placeholder="msg.editor.changeNotePlaceholder"
                    @input="onChangeNoteInput"
                />

                <div class="bve-section-label bve-section-label--top">
                    <span>{{ msg.fields.planCompat }}</span>
                    <span class="bve-section-count">{{ selectedCountText }}</span>
                </div>
                <BundlePlanCompatPicker
                    :plans="plans"
                    :live-plan-versions="livePlanVersions"
                    :bundle-features="form.features"
                    :bundle-quotas="form.quotas"
                    :selected-keys="form.planIds"
                    :locked="locked"
                    :feature-registry="featureRegistry"
                    :available-quotas="availableQuotas"
                    :quota-registry="quotaRegistry"
                    @toggle="onTogglePlan"
                />
            </section>
        </div>

        <div v-if="!locked" class="bve-actions">
            <button
                type="button"
                class="bve-btn"
                :disabled="saving || !hasChanges"
                @click="onReset"
            >
                {{ common.reset }}
            </button>
            <button
                type="button"
                class="bve-btn bve-btn--primary"
                :disabled="!canSave || saving"
                :title="!canSave ? msg.editor.saveDisabledTooltip : msg.editor.saveTooltip"
                @click="onSave"
            >
                {{ saving ? common.saving : common.save }}
            </button>
        </div>
        <div v-if="saveError" class="bve-error">
            {{ saveError }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type {
    BundleVersionRow,
    DiscoveredFeature,
    DiscoveredQuota,
    PlanRow,
    PlanVersionRow,
    UpdateBundleVersionDraftData,
} from '@saasicat/types';

import BundleFeaturesEditor, { type FeatureMeta } from './BundleFeaturesEditor.vue';
import BundlePlanCompatPicker from './BundlePlanCompatPicker.vue';
import BundleQuotasEditor from './BundleQuotasEditor.vue';
import BundleStatusBanner from './BundleStatusBanner.vue';
import type { QuotaMeta } from './catalog-i18n.js';
import { bundleVersionStatus, findBundlePlanOverlap, formatDate } from './bundle-version-status';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// BundleVersionInlineEditor — orchestrates the five sub-components (status
// banner + features editor + quotas editor + pricing/validity block +
// plan compat picker) into a 2-column inline editor, modeled on the plan
// simulation (saasadminui/project/bundles.jsx → BundleVersionEditor).
//
// Editability follows the backend helper: live/superseded are read-only,
// draft/scheduled (pre-active, latest-in-chain, 0 subs) are freely editable.
// Saving emits a `save` event with the diff to the original — the
// consumer calls the composable method (`updateDraft`).

interface Form {
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: string | null;
    yearlyNet: string | null;
    marketed: boolean;
    changeNote: string;
    validFrom: string | null;
    validUntil: string | null;
    /** Compatible plan keys; wire field `compatibility.planIds`. */
    planIds: string[];
}

const props = withDefaults(
    defineProps<{
        version: BundleVersionRow;
        availableFeatures: DiscoveredFeature[];
        availableQuotas: DiscoveredQuota[];
        plans: PlanRow[];
        /** Live (or latest) plan version per planKey for overlap check. */
        livePlanVersions?: Record<string, PlanVersionRow | null>;
        featureRegistry?: Record<string, FeatureMeta>;
        quotaRegistry?: Record<string, QuotaMeta>;
        saving?: boolean;
        saveError?: string | null;
        /** Reference timestamp for the status check (tests). */
        now?: Date;
    }>(),
    {
        livePlanVersions: () => ({}),
        featureRegistry: () => ({}),
        quotaRegistry: () => ({}),
        saving: false,
        saveError: null,
    },
);

const emit = defineEmits<{
    (e: 'save', data: UpdateBundleVersionDraftData): void;
    (e: 'discard'): void;
}>();

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

const msg = useSaMessages('bundles');
const common = useSaMessages('common');
const { locale } = useSuperAdminI18n();

function buildForm(v: BundleVersionRow): Form {
    return {
        features: [...v.features],
        quotas: { ...v.quotas },
        monthlyNet: v.monthlyNet,
        yearlyNet: v.yearlyNet,
        marketed: v.marketed,
        changeNote: v.changeNote,
        validFrom: v.validFrom ? v.validFrom.slice(0, 10) : null,
        validUntil: v.validUntil ? v.validUntil.slice(0, 10) : null,
        planIds: [...(v.compatibility?.planIds ?? [])],
    };
}

const form = reactive<Form>(buildForm(props.version));
let baseline: Form = buildForm(props.version);

watch(
    () => props.version.id,
    () => {
        const next = buildForm(props.version);
        Object.assign(form, next);
        baseline = next;
    },
);

const status = computed(() => bundleVersionStatus(props.version, props.now));
const locked = computed(() => status.value === 'live' || status.value === 'superseded');

// ── Pricing display ────────────────────────────────────────
const savingsPercent = computed<number | null>(() => {
    const m = Number(form.monthlyNet);
    const y = Number(form.yearlyNet);
    if (!Number.isFinite(m) || !Number.isFinite(y) || m <= 0 || y <= 0) return null;
    const fullYear = m * 12;
    if (y >= fullYear) return 0;
    return Math.round((1 - y / fullYear) * 100);
});

const monthlyEquivalent = computed(() => {
    const y = Number(form.yearlyNet);
    if (!Number.isFinite(y) || y <= 0) return '—';
    return (y / 12).toFixed(2);
});

const yearlyEquivalentText = computed(() =>
    formatMessage(msg.value.editor.yearlyEquivalent, { amount: monthlyEquivalent.value }),
);
const savingsText = computed(() =>
    formatMessage(msg.value.editor.savings, { percent: savingsPercent.value ?? 0 }),
);
const selectedCountText = computed(() =>
    formatMessage(msg.value.editor.selectedCount, { count: form.planIds.length }),
);
const validUntilDisplay = computed(
    () => formatDate(form.validUntil, locale.value) || msg.value.fields.validUntilOpen,
);

// ── Validation ─────────────────────────────────────────────
const validFromError = computed<string | null>(() => {
    if (locked.value) return null;
    if (!form.validFrom) return msg.value.validation.validFromRequired;
    return null;
});

const priceError = computed<string | null>(() => {
    if (locked.value) return null;
    if (form.monthlyNet && !PRICE_RE.test(form.monthlyNet)) {
        return msg.value.validation.monthlyPriceFormat;
    }
    if (form.yearlyNet && !PRICE_RE.test(form.yearlyNet)) {
        return msg.value.validation.yearlyPriceFormat;
    }
    return null;
});

const validationError = computed(() => priceError.value ?? validFromError.value);

// ── Overlap aggregated over all selected plans ─────────────
const aggregatedOverlap = computed(() => {
    const features = new Set<string>();
    const quotas = new Set<string>();
    for (const planKey of form.planIds) {
        const overlap = findBundlePlanOverlap(
            { features: form.features, quotas: form.quotas },
            props.livePlanVersions[planKey] ?? null,
        );
        for (const f of overlap.features) features.add(f);
        for (const q of overlap.quotas) quotas.add(q);
    }
    return { features: [...features], quotas: [...quotas] };
});

const aggregatedOverlapFeatures = computed(() => aggregatedOverlap.value.features);
const aggregatedOverlapQuotas = computed(() => aggregatedOverlap.value.quotas);

const overlapPlansCount = computed(
    () =>
        form.planIds.filter(
            (k) =>
                findBundlePlanOverlap(
                    { features: form.features, quotas: form.quotas },
                    props.livePlanVersions[k] ?? null,
                ).hasAny,
        ).length,
);

const hasOverlap = computed(() => overlapPlansCount.value > 0);

// ── Change detection ───────────────────────────────────────
const hasChanges = computed(() => {
    if (form.monthlyNet !== baseline.monthlyNet) return true;
    if (form.yearlyNet !== baseline.yearlyNet) return true;
    if (form.marketed !== baseline.marketed) return true;
    if (form.changeNote !== baseline.changeNote) return true;
    if (form.validFrom !== baseline.validFrom) return true;
    if (form.validUntil !== baseline.validUntil) return true;
    if (!arraysEqual(form.features, baseline.features)) return true;
    if (!arraysEqual(form.planIds, baseline.planIds)) return true;
    if (!recordsEqual(form.quotas, baseline.quotas)) return true;
    return false;
});

const canSave = computed(() => hasChanges.value && validationError.value === null);

// ── Event handlers ─────────────────────────────────────────
function onToggleFeature(featureKey: string): void {
    if (locked.value) return;
    const idx = form.features.indexOf(featureKey);
    if (idx >= 0) form.features.splice(idx, 1);
    else {
        form.features.push(featureKey);
        form.features.sort();
    }
}

function onToggleQuota(quotaKey: string): void {
    if (locked.value) return;
    if (quotaKey in form.quotas) {
        const next = { ...form.quotas };
        delete next[quotaKey];
        form.quotas = next;
    } else {
        form.quotas = { ...form.quotas, [quotaKey]: 0 };
    }
}

function onSetQuotaValue(quotaKey: string, value: number): void {
    if (locked.value) return;
    form.quotas = { ...form.quotas, [quotaKey]: Number.isFinite(value) ? value : 0 };
}

function onTogglePlan(planKey: string): void {
    if (locked.value) return;
    const idx = form.planIds.indexOf(planKey);
    if (idx >= 0) form.planIds.splice(idx, 1);
    else form.planIds.push(planKey);
}

function onPriceInput(field: 'monthlyNet' | 'yearlyNet', event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    form[field] = value.length === 0 ? null : value;
}

function onValidFromInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    form.validFrom = value.length === 0 ? null : value;
}

function onChangeNoteInput(event: Event): void {
    form.changeNote = (event.target as HTMLTextAreaElement).value;
}

function onMarketedToggle(event: Event): void {
    form.marketed = (event.target as HTMLInputElement).checked;
}

function onReset(): void {
    Object.assign(form, buildForm(props.version));
}

function onSave(): void {
    if (!canSave.value || props.saving) return;
    emit('save', {
        features: [...form.features],
        quotas: { ...form.quotas },
        monthlyNet: form.monthlyNet,
        yearlyNet: form.yearlyNet,
        marketed: form.marketed,
        changeNote: form.changeNote,
        validFrom: form.validFrom,
        validUntil: form.validUntil,
        compatibility: {
            ...(props.version.compatibility ?? {}),
            planIds: [...form.planIds],
        },
    });
}

function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
}

function recordsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((k, i) => k === bKeys[i])) return false;
    return aKeys.every((k) => a[k] === b[k]);
}
</script>

<style scoped>
.bve {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.bve-overlap-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #b91c1c;
    font-size: 12.5px;
    line-height: 1.5;
}
.bve-overlap-ico {
    font-weight: 700;
}
.bve-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
}
@media (max-width: 1100px) {
    .bve-grid {
        grid-template-columns: 1fr;
    }
}
.bve-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.bve-section-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: 11.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #475569;
    padding-top: 2px;
}
.bve-section-label--top {
    margin-top: 8px;
}
.bve-section-count {
    font-size: 10.5px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: none;
    letter-spacing: 0;
}
.bve-row {
    display: grid;
    gap: 10px;
}
.bve-row--pricing {
    grid-template-columns: 1fr 1fr auto;
    align-items: end;
}
.bve-row--validity {
    grid-template-columns: 1fr 1fr;
}
.bve-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.bve-field-label {
    font-size: 11px;
    color: #475569;
    font-weight: 600;
}
.bve-field-hint {
    font-size: 10.5px;
    color: #94a3b8;
}
.bve-input-grp {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    background: #fff;
}
.bve-input-grp .bve-input {
    border: 0;
    border-radius: 6px 0 0 6px;
}
.bve-input-unit {
    display: inline-flex;
    align-items: center;
    padding: 0 8px;
    font-size: 11.5px;
    color: #64748b;
    background: #f8fafc;
    border-left: 1px solid #e2e8f0;
    border-radius: 0 6px 6px 0;
}
.bve-input {
    padding: 6px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    font-family: inherit;
    color: #0f172a;
    background: #fff;
}
.bve-input--readonly {
    color: #94a3b8;
    background: #f8fafc;
}
.bve-savings {
    font-size: 11.5px;
    color: #475569;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 6px;
}
.bve-savings-pill {
    padding: 1px 6px;
    background: #d1fae5;
    color: #065f46;
    border-radius: 4px;
    font-weight: 700;
    font-size: 10.5px;
    letter-spacing: 0.04em;
}
.bve-toggle-row {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 13px;
}
.bve-toggle-label {
    color: #0f172a;
}
.bve-textarea {
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    font-size: 13px;
    font-family: inherit;
    color: #0f172a;
    background: #fff;
    resize: vertical;
}
.bve-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
.bve-btn {
    padding: 7px 14px;
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12.5px;
    font-family: inherit;
    color: #0f172a;
}
.bve-btn:hover:not(:disabled) {
    background: #f8fafc;
}
.bve-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
.bve-btn--primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
}
.bve-btn--primary:hover:not(:disabled) {
    background: #1d4ed8;
}
.bve-error {
    padding: 8px 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 6px;
    color: #b91c1c;
    font-size: 12.5px;
}
</style>

<template>
    <section class="bcp">
        <div class="bcp-head">
            <div>
                <div class="bcp-title">{{ msg.create.title }}</div>
                <div class="bcp-sub">{{ msg.create.subtitle }}</div>
            </div>
            <button class="bcp-close" type="button" :aria-label="common.close" @click="close">
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                >
                    <path d="M18 6L6 18M6 6l12 12" />
                </svg>
            </button>
        </div>

        <div class="bcp-body">
            <!-- 1: MASTER DATA -->
            <section class="bcp-section">
                <div class="bcp-section-head">
                    <span class="bcp-section-num">1</span>
                    <div>
                        <div class="bcp-section-title">{{ msg.fields.masterData }}</div>
                        <div class="bcp-section-sub">{{ msg.create.masterDataHint }}</div>
                    </div>
                </div>
                <div class="bcp-grid">
                    <label class="bcp-field bcp-col-2">
                        <span class="bcp-field-label">{{ msg.fields.label }}</span>
                        <q-input
                            outlined
                            dense
                            ref="labelInput"
                            v-model="form.label"
                            :placeholder="msg.create.labelPlaceholder"
                        />
                    </label>
                    <label class="bcp-field bcp-col-2">
                        <span class="bcp-field-label">
                            {{ msg.create.bundleKey }}
                            <span class="bcp-field-hint">{{ msg.create.bundleKeyHint }}</span>
                        </span>
                        <q-input
                            outlined
                            dense
                            v-model="form.bundleKey"
                            class="bcp-mono"
                            placeholder="COMMUNICATION_PRO"
                            @input="onBundleKeyInput"
                        />
                        <span v-if="bundleKeyError" class="bcp-error-inline">
                            {{ bundleKeyError }}
                        </span>
                    </label>
                    <label class="bcp-field bcp-col-2">
                        <span class="bcp-field-label">{{ common.description }}</span>
                        <q-input
                            v-model="form.description"
                            outlined
                            dense
                            type="textarea"
                            :rows="2"
                            :placeholder="msg.create.descriptionPlaceholder"
                        />
                    </label>
                </div>
            </section>

            <!-- 2: PRICING + VALIDFROM -->
            <section class="bcp-section">
                <div class="bcp-section-head">
                    <span class="bcp-section-num">2</span>
                    <div>
                        <div class="bcp-section-title">{{ msg.create.sectionPricing }}</div>
                        <div class="bcp-section-sub">{{ msg.create.pricingHint }}</div>
                    </div>
                </div>
                <div class="bcp-grid">
                    <label class="bcp-field">
                        <span class="bcp-field-label">{{ msg.fields.monthlyPrice }}</span>
                        <div class="bcp-input-grp">
                            <q-input
                                outlined
                                dense
                                v-model="form.monthlyNet"
                                type="text"
                                inputmode="decimal"
                                class="bcp-input"
                                placeholder="9.90"
                            />
                            <span class="bcp-input-unit">{{ msg.fields.perMonthUnit }}</span>
                        </div>
                    </label>
                    <label class="bcp-field">
                        <span class="bcp-field-label">{{ msg.fields.yearlyPrice }}</span>
                        <div class="bcp-input-grp">
                            <q-input
                                outlined
                                dense
                                v-model="form.yearlyNet"
                                type="text"
                                inputmode="decimal"
                                class="bcp-input"
                                placeholder="99.00"
                            />
                            <span class="bcp-input-unit">{{ msg.fields.perYearUnit }}</span>
                        </div>
                    </label>
                    <label class="bcp-field bcp-col-2">
                        <span class="bcp-field-label">{{ msg.fields.validFrom }}</span>
                        <q-input outlined dense v-model="form.validFrom" type="date" />
                        <span class="bcp-field-hint">{{ validFromHint }}</span>
                    </label>
                </div>
            </section>

            <!-- 3: PLAN COMPAT -->
            <section class="bcp-section">
                <div class="bcp-section-head">
                    <span class="bcp-section-num">3</span>
                    <div>
                        <div class="bcp-section-title">{{ msg.fields.planCompat }}</div>
                        <div class="bcp-section-sub">{{ msg.create.planCompatHint }}</div>
                    </div>
                </div>
                <BundlePlanCompatPicker
                    :plans="plans"
                    :live-plan-versions="livePlanVersions"
                    :bundle-features="form.features"
                    :bundle-quotas="form.quotas"
                    :selected-keys="form.planIds"
                    :feature-registry="featureRegistry"
                    :available-quotas="availableQuotas"
                    :quota-registry="quotaRegistry"
                    @toggle="onTogglePlan"
                />
            </section>

            <!-- 4: FEATURES -->
            <section class="bcp-section">
                <div class="bcp-section-head">
                    <span class="bcp-section-num">4</span>
                    <div>
                        <div class="bcp-section-title">{{ msg.create.sectionFeatures }}</div>
                        <div class="bcp-section-sub">{{ featureSelectionText }}</div>
                    </div>
                </div>
                <BundleFeaturesEditor
                    :available-features="availableFeatures"
                    :features="form.features"
                    :feature-registry="featureRegistry"
                    :overlap-keys="aggregatedOverlapFeatures"
                    @toggle="onToggleFeature"
                />
            </section>

            <!-- 5: QUOTAS -->
            <section class="bcp-section">
                <div class="bcp-section-head">
                    <span class="bcp-section-num">5</span>
                    <div>
                        <div class="bcp-section-title">
                            {{ msg.fields.quotas }}
                            <span class="bcp-field-hint" style="margin-left: var(--sa-gap-inline)">
                                {{ msg.create.quotasOptional }}
                            </span>
                        </div>
                        <div class="bcp-section-sub">{{ msg.create.quotasHint }}</div>
                    </div>
                </div>
                <BundleQuotasEditor
                    :available-quotas="availableQuotas"
                    :quotas="form.quotas"
                    :overlap-keys="aggregatedOverlapQuotas"
                    :quota-registry="quotaRegistry"
                    @toggle="onToggleQuota"
                    @set-value="onSetQuotaValue"
                />
            </section>

            <div v-if="submitError" class="bcp-error" role="alert">{{ submitError }}</div>
        </div>

        <div class="bcp-foot">
            <span v-if="overlapPlansCount > 0" class="bcp-foot-hint bcp-foot-hint--warn">
                {{ overlapWarningText }}
            </span>
            <span v-else-if="form.features.length > 0" class="bcp-foot-hint">
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                >
                    <path d="M5 13l4 4L19 7" />
                </svg>
                <span>
                    <b>{{ form.features.length }}</b>
                    {{
                        form.features.length === 1
                            ? msg.create.summaryFeatureOne
                            : msg.create.summaryFeatureMany
                    }}
                    <template v-if="quotaCount > 0">
                        · <b>{{ quotaCount }}</b>
                        {{
                            quotaCount === 1
                                ? msg.create.summaryQuotaOne
                                : msg.create.summaryQuotaMany
                        }}
                    </template>
                    <template v-if="form.planIds.length > 0">
                        · <b>{{ form.planIds.length }}</b> {{ msg.create.summaryPlanCompat }}
                    </template>
                </span>
            </span>
            <button class="bcp-btn" type="button" @click="close">{{ common.cancel }}</button>
            <button
                class="bcp-btn bcp-btn--primary"
                type="button"
                :disabled="!canSubmit || submitting"
                @click="submit"
            >
                {{ submitting ? msg.create.submitting : msg.create.submit }}
            </button>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import type {
    BundleRow,
    BundleVersionMutationResult,
    CreateBundleData,
    CreateBundleVersionDraftData,
    DiscoveredFeature,
    DiscoveredQuota,
    PlanRow,
    PlanVersionRow,
} from '@saasicat/core';

import BundleFeaturesEditor, { type FeatureMeta } from './BundleFeaturesEditor.vue';
import BundlePlanCompatPicker from './BundlePlanCompatPicker.vue';
import BundleQuotasEditor from './BundleQuotasEditor.vue';
import type { QuotaMeta } from './catalog-i18n.js';
import { findBundlePlanOverlap, formatDate } from './bundle-version-status';
import { formatMessage } from '../../../client/i18n/format.js';
import { trimChar } from '../../../client/text-shape.js';
import { useSaMessages, useSuperAdminI18n } from '../../../vue/use-super-admin-i18n.js';

// BundleCreatePanel — expandable inline panel for creating a new
// bundle (root + v1 draft) at the top of the bundle list. Uses the same
// sub-editors as the inline editor (features, quotas, plan-compat picker),
// so that creation and editing look consistent and behave the same.

interface Form {
    label: string;
    bundleKey: string;
    description: string;
    monthlyNet: string;
    yearlyNet: string;
    validFrom: string;
    features: string[];
    quotas: Record<string, number>;
    planIds: string[];
}

const props = withDefaults(
    defineProps<{
        projectKey: string;
        availableFeatures: DiscoveredFeature[];
        availableQuotas: DiscoveredQuota[];
        plans: PlanRow[];
        livePlanVersions?: Record<string, PlanVersionRow | null>;
        featureRegistry?: Record<string, FeatureMeta>;
        quotaRegistry?: Record<string, QuotaMeta>;
        existingBundleKeys: string[];
        create: (data: CreateBundleData) => Promise<BundleRow>;
        createDraft: (
            bundleId: string,
            data: Omit<CreateBundleVersionDraftData, 'bundleId'>,
        ) => Promise<BundleVersionMutationResult>;
    }>(),
    {
        livePlanVersions: () => ({}),
        featureRegistry: () => ({}),
        quotaRegistry: () => ({}),
    },
);

const emit = defineEmits<{
    (e: 'cancel'): void;
    (e: 'created', bundle: BundleRow): void;
}>();

const msg = useSaMessages('bundles');
const common = useSaMessages('common');
const { locale } = useSuperAdminI18n();

const todayIso = computed(() => new Date().toISOString().slice(0, 10));

const validFromHint = computed(() => {
    if (!form.validFrom) return msg.value.create.validFromHint;
    if (form.validFrom <= todayIso.value) return msg.value.create.validFromImmediate;
    return formatMessage(msg.value.create.validFromScheduled, {
        date: formatDate(form.validFrom, locale.value),
    });
});

const BUNDLE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;

function emptyForm(): Form {
    return {
        label: '',
        bundleKey: '',
        description: '',
        monthlyNet: '9.90',
        yearlyNet: '99.00',
        validFrom: new Date().toISOString().slice(0, 10),
        features: [],
        quotas: {},
        planIds: [],
    };
}

const form = reactive<Form>(emptyForm());
const submitting = ref(false);
const submitError = ref<string | null>(null);
const keyTouched = ref(false);
const labelInput = ref<HTMLInputElement | null>(null);

onMounted(() => {
    nextTick(() => labelInput.value?.focus());
});

// As long as the key has not been edited manually, derive it from the label.
watch(
    () => form.label,
    (label) => {
        if (!keyTouched.value) form.bundleKey = bundleKeyify(label);
    },
);

function bundleKeyify(s: string): string {
    const collapsed = s
        .toUpperCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Z0-9]+/g, '_');
    return trimChar(collapsed, '_').slice(0, 32);
}

function onBundleKeyInput(event: Event): void {
    keyTouched.value = true;
    form.bundleKey = bundleKeyify((event.target as HTMLInputElement).value);
}

// ── Validation ────────────────────────────────────────────
const bundleKeyError = computed<string | null>(() => {
    if (!form.bundleKey) return null;
    if (!BUNDLE_KEY_PATTERN.test(form.bundleKey)) {
        return msg.value.create.errorKeyFormat;
    }
    if (props.existingBundleKeys.includes(form.bundleKey)) {
        return msg.value.create.errorKeyExists;
    }
    return null;
});

const featureSelectionText = computed(() =>
    formatMessage(msg.value.create.selectedOfTotal, {
        selected: form.features.length,
        total: props.availableFeatures.length,
    }),
);

const canSubmit = computed(() => {
    if (!form.label.trim()) return false;
    if (!form.bundleKey) return false;
    if (bundleKeyError.value) return false;
    if (form.monthlyNet && !PRICE_RE.test(form.monthlyNet)) return false;
    if (form.yearlyNet && !PRICE_RE.test(form.yearlyNet)) return false;
    if (!form.validFrom) return false;
    return true;
});

// ── Overlap aggregated across selected plans ───────────────
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

const overlapWarningText = computed(() =>
    formatMessage(
        overlapPlansCount.value === 1
            ? msg.value.create.overlapWarningOne
            : msg.value.create.overlapWarningMany,
        { count: overlapPlansCount.value },
    ),
);

const quotaCount = computed(() => Object.keys(form.quotas).length);

// ── Event handlers ────────────────────────────────────────
function onToggleFeature(featureKey: string): void {
    const idx = form.features.indexOf(featureKey);
    if (idx >= 0) form.features.splice(idx, 1);
    else {
        form.features.push(featureKey);
        form.features.sort();
    }
}

function onToggleQuota(quotaKey: string): void {
    if (quotaKey in form.quotas) {
        const next = { ...form.quotas };
        delete next[quotaKey];
        form.quotas = next;
    } else {
        form.quotas = { ...form.quotas, [quotaKey]: 0 };
    }
}

function onSetQuotaValue(quotaKey: string, value: number): void {
    form.quotas = { ...form.quotas, [quotaKey]: Number.isFinite(value) ? value : 0 };
}

function onTogglePlan(planKey: string): void {
    const idx = form.planIds.indexOf(planKey);
    if (idx >= 0) form.planIds.splice(idx, 1);
    else form.planIds.push(planKey);
}

function close(): void {
    emit('cancel');
}

async function submit(): Promise<void> {
    if (!canSubmit.value || submitting.value) return;
    submitting.value = true;
    submitError.value = null;
    try {
        const bundle = await props.create({
            projectKey: props.projectKey,
            bundleKey: form.bundleKey,
            label: form.label,
            description: form.description || undefined,
        });
        await props.createDraft(bundle.id, {
            features: [...form.features],
            quotas: { ...form.quotas },
            monthlyNet: form.monthlyNet || null,
            yearlyNet: form.yearlyNet || null,
            marketed: true,
            changeNote: 'Initial v1',
            validFrom: form.validFrom,
            compatibility: form.planIds.length > 0 ? { planIds: [...form.planIds] } : undefined,
        });
        emit('created', bundle);
    } catch (err) {
        submitError.value = err instanceof Error ? err.message : String(err);
    } finally {
        submitting.value = false;
    }
}
</script>

<style scoped>
/* The key is an identifier; a proportional face hides a transposed character. */
.bcp-mono :deep(input) {
    font-family: var(--sa-font-mono);
}

.bcp {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-card);
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 24px var(--sa-shadow-tint-2);
}
.bcp-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sa-space-5);
    padding: var(--sa-space-5) var(--sa-space-6) var(--sa-space-4);
    border-bottom: 1px solid var(--sa-color-border);
}
.bcp-title {
    font-size: var(--sa-text-xl);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
    letter-spacing: var(--sa-tracking-normal);
}
.bcp-sub {
    margin-top: var(--sa-space-2);
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-muted);
    max-width: 580px;
    line-height: 1.5;
}
.bcp-close {
    background: transparent;
    border: 0;
    cursor: pointer;
    color: var(--sa-color-fg-muted);
    padding: var(--sa-space-2);
    border-radius: var(--sa-radius-badge);
}
.bcp-close:hover {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-heading);
}
.bcp-body {
    padding: var(--sa-space-5) var(--sa-space-6);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-5);
}
.bcp-section {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.bcp-section-head {
    display: flex;
    align-items: flex-start;
    gap: var(--sa-space-3);
}
.bcp-section-num {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--sa-radius-pill);
    background: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
    font:
        700 var(--sa-text-sm) 'JetBrains Mono',
        ui-monospace,
        monospace;
    flex: 0 0 auto;
}
.bcp-section-title {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    color: var(--sa-color-fg-heading);
}
.bcp-section-sub {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-1);
    line-height: 1.4;
}
.bcp-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sa-space-4);
}
.bcp-col-2 {
    grid-column: span 2;
}
.bcp-field {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.bcp-field-label {
    font-size: var(--sa-text-sm);
    font-weight: 600;
    color: var(--sa-color-fg-secondary);
}
.bcp-field-hint {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    font-weight: 500;
}
.bcp-input-grp {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-badge);
}
.bcp-input-grp .bcp-input-unit {
    display: inline-flex;
    align-items: center;
    padding: 0 var(--sa-space-3);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    background: var(--sa-color-bg-sunken);
    border-left: 1px solid var(--sa-color-border);
    border-radius: 0 var(--sa-radius-badge) var(--sa-radius-badge) 0;
}
.bcp-error-inline {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-negative-fg);
}
.bcp-error {
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-negative-surface);
    border: 1px solid var(--sa-color-negative-border);
    border-radius: var(--sa-radius-badge);
    color: var(--sa-color-negative-fg);
    font-size: var(--sa-text-md);
}
.bcp-foot {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-4) var(--sa-space-6);
    border-top: 1px solid var(--sa-color-border);
    background: var(--sa-color-bg-sunken);
    border-radius: 0 0 var(--sa-radius-card) var(--sa-radius-card);
}
.bcp-foot-hint {
    flex: 1;
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
}
.bcp-foot-hint--warn {
    color: var(--sa-color-negative-fg);
    font-weight: 600;
}
.bcp-btn {
    padding: var(--sa-space-3) var(--sa-space-4);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border-strong);
    border-radius: var(--sa-radius-badge);
    cursor: pointer;
    font-size: var(--sa-text-md);
    font-family: inherit;
    color: var(--sa-color-fg-heading);
}
.bcp-btn:hover:not(:disabled) {
    background: var(--sa-color-bg-sunken);
}
.bcp-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
.bcp-btn--primary {
    background: var(--sa-color-accent);
    border-color: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
}
.bcp-btn--primary:hover:not(:disabled) {
    background: var(--sa-color-accent-strong);
}
</style>

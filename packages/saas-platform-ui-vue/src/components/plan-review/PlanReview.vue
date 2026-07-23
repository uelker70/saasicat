<template>
    <div class="pr">
        <!-- Header -->
        <div class="pr-head">
            <div class="pr-head-text">
                <h2 class="pr-title">{{ msg.review.title }}</h2>
                <p class="pr-sub">
                    {{ msg.review.subtitleLead }}
                    <code class="pr-mono">{{ plan.planKey }}@v{{ version.version }}</code>
                    {{ msg.review.subtitleTail }}
                </p>
            </div>
            <div class="pr-head-actions">
                <button
                    class="pr-btn"
                    type="button"
                    :disabled="publishing || saving"
                    @click="$emit('back')"
                >
                    <span class="pr-ico pr-ico--back" aria-hidden="true">
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <path d="M5 12h14M13 5l7 7-7 7" />
                        </svg>
                    </span>
                    <span>{{ common.back }}</span>
                </button>
                <button
                    class="pr-btn"
                    type="button"
                    :disabled="publishing || saving"
                    @click="$emit('saveAndExit')"
                >
                    {{ saving ? msg.review.saving : msg.review.saveAsDraft }}
                </button>
                <button
                    class="pr-btn pr-btn--primary"
                    type="button"
                    :disabled="!canPublish || publishing || saving"
                    :title="canPublish ? undefined : msg.review.publishBlocked"
                    @click="onPublish"
                >
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                    <span>{{ publishing ? msg.review.publishing : publishLabel }}</span>
                </button>
            </div>
        </div>

        <div v-if="publishError" class="pr-banner">{{ publishError }}</div>

        <div class="pr-grid">
            <!-- Left column -->
            <div class="pr-col">
                <div class="pr-card">
                    <h3 class="pr-card-title">{{ msg.review.cardMasterData }}</h3>
                    <div class="pr-row">
                        <div class="pr-label">{{ msg.review.labelPlanKey }}</div>
                        <div class="pr-val pr-mono">{{ plan.planKey }}</div>
                    </div>
                    <div class="pr-row">
                        <div class="pr-label">{{ msg.review.labelDisplayName }}</div>
                        <div class="pr-val">{{ plan.label }}</div>
                    </div>
                    <div class="pr-row">
                        <div class="pr-label">{{ common.description }}</div>
                        <div class="pr-val">
                            <template v-if="plan.description">{{ plan.description }}</template>
                            <i v-else class="pr-missing">{{ msg.review.missing }}</i>
                        </div>
                    </div>
                </div>

                <div class="pr-card">
                    <h3 class="pr-card-title">{{ pricingCardTitle }}</h3>
                    <div class="pr-row">
                        <div class="pr-label">{{ msg.review.labelValidFrom }}</div>
                        <div class="pr-val">
                            <template v-if="version.validFrom">{{
                                version.validFrom.slice(0, 10)
                            }}</template>
                            <i v-else class="pr-missing">{{
                                msg.review.missingRequiredOnPublish
                            }}</i>
                        </div>
                    </div>
                    <div class="pr-row">
                        <div class="pr-label">{{ msg.review.labelValidUntil }}</div>
                        <div class="pr-val">
                            <template v-if="version.validUntil">{{
                                version.validUntil.slice(0, 10)
                            }}</template>
                            <span v-else class="pr-inf">{{ msg.review.unlimited }}</span>
                        </div>
                    </div>
                    <div class="pr-row">
                        <div class="pr-label">{{ msg.review.labelMonthlyPrice }}</div>
                        <div class="pr-val">
                            <template v-if="hasMonthly">{{
                                formatMoney(version.monthlyNet)
                            }}</template>
                            <i v-else class="pr-missing">{{ msg.review.missing }}</i>
                        </div>
                    </div>
                    <div class="pr-row">
                        <div class="pr-label">{{ msg.review.labelYearlyPrice }}</div>
                        <div class="pr-val">{{ formatMoney(version.yearlyNet) }}</div>
                    </div>
                    <div class="pr-row">
                        <div class="pr-label">{{ msg.review.labelPublicCatalog }}</div>
                        <div class="pr-val">
                            <span v-if="version.marketed" class="pr-chip pr-chip--live">{{
                                msg.review.visibleInCatalog
                            }}</span>
                            <span v-else class="pr-chip pr-chip--muted">{{
                                msg.review.hiddenFromCatalog
                            }}</span>
                        </div>
                    </div>
                </div>

                <div class="pr-card">
                    <h3 class="pr-card-title">{{ componentsCardTitle }}</h3>
                    <div class="pr-components">
                        <div class="pr-comp-col">
                            <div class="pr-comp-head pr-comp-head--quota">
                                {{ quotaSectionTitle }}
                            </div>
                            <div v-for="q in quotaList" :key="q.key" class="pr-comp-item">
                                <span>{{ q.label }}</span>
                                <b>{{ q.value }}{{ q.unit ? ' ' + q.unit : '' }}</b>
                            </div>
                            <div v-if="quotaList.length === 0" class="pr-comp-empty">
                                {{ msg.review.componentEmpty }}
                            </div>
                        </div>
                        <div class="pr-comp-col">
                            <div class="pr-comp-head pr-comp-head--feature">
                                {{ featureSectionTitle }}
                            </div>
                            <div v-for="f in featureList" :key="f.key" class="pr-comp-item">
                                <span>{{ f.label }}</span>
                            </div>
                            <div v-if="featureList.length === 0" class="pr-comp-empty">
                                {{ msg.review.componentEmpty }}
                            </div>
                        </div>
                        <div class="pr-comp-col">
                            <div class="pr-comp-head pr-comp-head--bundle">
                                {{ bundleSectionTitle }}
                            </div>
                            <div v-for="b in bundleList" :key="b.key" class="pr-comp-item">
                                <span>{{ b.label }}</span>
                            </div>
                            <div v-if="bundleList.length === 0" class="pr-comp-empty">
                                {{ msg.review.componentEmpty }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right column -->
            <div class="pr-col">
                <div class="pr-card">
                    <h3 class="pr-card-title">
                        {{ msg.review.cardChangeNote }} <span class="pr-req">*</span>
                    </h3>
                    <p class="pr-card-hint">{{ msg.review.changeNoteHint }}</p>
                    <div v-if="version.changeNote" class="pr-note">{{ version.changeNote }}</div>
                    <div v-else class="pr-note pr-note--missing">
                        {{ msg.review.changeNoteMissing }}
                    </div>
                </div>

                <div class="pr-card">
                    <h3 class="pr-card-title">{{ msg.review.cardChecklist }}</h3>
                    <div class="pr-checks">
                        <div
                            v-for="c in checks"
                            :key="c.id"
                            class="pr-check"
                            :class="c.ok ? 'pr-check--ok' : 'pr-check--warn'"
                        >
                            <span class="pr-check-mark">
                                <svg
                                    v-if="c.ok"
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="3.5"
                                >
                                    <path d="M5 13l4 4L19 7" />
                                </svg>
                                <svg
                                    v-else
                                    width="11"
                                    height="11"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2.5"
                                >
                                    <path
                                        d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"
                                    />
                                </svg>
                            </span>
                            <span>{{ c.label }}</span>
                        </div>
                    </div>
                </div>

                <div v-if="predecessor" class="pr-card pr-card--regress">
                    <h3 class="pr-card-title">{{ msg.review.cardRegression }}</h3>
                    <p class="pr-card-hint">{{ msg.review.regressionHint }}</p>
                    <label class="pr-toggle">
                        <input v-model="forceRegressive" type="checkbox" />
                        <span>{{ msg.review.forceRegressive }}</span>
                    </label>
                </div>

                <div class="pr-card">
                    <h3 class="pr-card-title">{{ msg.review.cardZeroPrice }}</h3>
                    <p class="pr-card-hint">{{ msg.review.zeroPriceHint }}</p>
                    <label class="pr-toggle">
                        <input v-model="allowZeroPrice" type="checkbox" />
                        <span>{{ msg.review.allowZeroPrice }}</span>
                    </label>
                </div>

                <div class="pr-card pr-card--impact">
                    <h3 class="pr-card-title">{{ msg.review.cardTenantImpact }}</h3>
                    <div class="pr-impact">
                        <div class="pr-impact-num">{{ tenantImpactCount }}</div>
                        <div class="pr-impact-text">{{ impactText }}</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { PlanRow, PlanVersionRow } from '@saasicat/types';
import { formatMessage } from '../../client/i18n/format.js';
import { formatCurrency } from '../../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// PlanReview — step 3 of the plan wizard (SPEC_V2 §6, plan simulation
// "Review & Publish"). Shows the saved draft read-only, checks the
// publish checklist and triggers publish. The draft was already persisted
// in the editor (step 2); review mutates nothing except publish.

interface DiscoveryQuota {
    quotaKey: string;
    label?: string | null;
    unit?: string | null;
}
interface BundleEntry {
    bundleKey: string;
    label?: string | null;
    features: string[];
}
interface FeatureMeta {
    label?: string;
}

const props = withDefaults(
    defineProps<{
        plan: PlanRow;
        /** The draft to be reviewed (publishedAt === null). */
        version: PlanVersionRow;
        /** Current live version being published against (null for v1). */
        predecessor?: PlanVersionRow | null;
        availableQuotas?: DiscoveryQuota[];
        availableBundles?: BundleEntry[];
        featureRegistry?: Record<string, FeatureMeta>;
        /** Tenants on the current live version (for the impact card). */
        tenantImpactCount?: number;
        /** "Save as draft" in progress. */
        saving?: boolean;
        /** "Publish" in progress. */
        publishing?: boolean;
        /** Error text of a review action (save or publish). */
        publishError?: string | null;
    }>(),
    {
        predecessor: null,
        availableQuotas: () => [],
        availableBundles: () => [],
        featureRegistry: () => ({}),
        tenantImpactCount: 0,
        saving: false,
        publishing: false,
        publishError: null,
    },
);

const emit = defineEmits<{
    (e: 'back'): void;
    (e: 'saveAndExit'): void;
    (e: 'publish', payload: { forceRegressive: boolean; allowZeroPrice: boolean }): void;
}>();

const msg = useSaMessages('plans');
const { locale } = useSuperAdminI18n();
const common = useSaMessages('common');

const forceRegressive = ref(false);
const allowZeroPrice = ref(false);

const publishLabel = computed(() =>
    formatMessage(msg.value.review.publishVersion, { version: props.version.version }),
);

const pricingCardTitle = computed(() =>
    formatMessage(msg.value.review.cardPricing, { version: props.version.version }),
);

function quotasOf(v: PlanVersionRow): Record<string, number> {
    if (v.quotas && Object.keys(v.quotas).length > 0) return v.quotas;
    const legacy: Record<string, number> = {};
    if (typeof v.maxUsers === 'number') legacy.users = v.maxUsers;
    if (typeof v.maxVehicles === 'number') legacy.vehicles = v.maxVehicles;
    if (typeof v.maxStorageGb === 'number') legacy.storageGb = v.maxStorageGb;
    return legacy;
}

const quotaList = computed(() =>
    Object.entries(quotasOf(props.version))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => {
            const def = props.availableQuotas.find((q) => q.quotaKey === key);
            return { key, value, label: def?.label || key, unit: def?.unit || '' };
        }),
);

const featureList = computed(() =>
    [...props.version.features].sort().map((key) => ({
        key,
        label: props.featureRegistry[key]?.label ?? key,
    })),
);

const bundleList = computed(() =>
    [...(props.version.bundles ?? [])].sort().map((key) => {
        const def = props.availableBundles.find((b) => b.bundleKey === key);
        return { key, label: def?.label || key };
    }),
);

const componentTotal = computed(
    () => quotaList.value.length + featureList.value.length + bundleList.value.length,
);

const componentsCardTitle = computed(() =>
    formatMessage(msg.value.review.cardComponents, { total: componentTotal.value }),
);
const quotaSectionTitle = computed(() =>
    formatMessage(msg.value.review.componentQuotas, { count: quotaList.value.length }),
);
const featureSectionTitle = computed(() =>
    formatMessage(msg.value.review.componentFeatures, { count: featureList.value.length }),
);
const bundleSectionTitle = computed(() =>
    formatMessage(msg.value.review.componentBundles, { count: bundleList.value.length }),
);

const impactText = computed(() =>
    props.tenantImpactCount === 0
        ? msg.value.review.impactNone
        : formatMessage(msg.value.review.impactSome, {
              count: props.tenantImpactCount,
              version: props.version.version,
          }),
);

// Valid price — even 0 € (free plan) counts as set; only an
// invalid/empty value counts as "missing".
const hasMonthly = computed(() => {
    const n = Number(props.version.monthlyNet);
    return props.version.monthlyNet !== '' && Number.isFinite(n) && n >= 0;
});

// "Gültig ab" must lie strictly after the "Gültig ab" of the predecessor
// version (SPEC_V2 §4.2.1) — otherwise the publish endpoint rejects.
const validFromAfterPredecessor = computed(() => {
    const prev = props.predecessor;
    if (!prev?.validFrom || !props.version.validFrom) return true;
    return props.version.validFrom.slice(0, 10) > prev.validFrom.slice(0, 10);
});

function formatMoney(raw: string | number): string {
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return String(raw);
    if (num === 0) return msg.value.review.priceFree;
    return formatCurrency(num, locale.value);
}

interface Check {
    id: string;
    label: string;
    ok: boolean;
}

const checks = computed<Check[]>(() => [
    { id: 'key', label: msg.value.review.checkPlanKey, ok: Boolean(props.plan.planKey) },
    { id: 'label', label: msg.value.review.checkDisplayName, ok: Boolean(props.plan.label) },
    {
        id: 'quota',
        label: msg.value.review.checkQuota,
        ok: quotaList.value.length > 0,
    },
    {
        id: 'feature',
        label: msg.value.review.checkFeature,
        ok: featureList.value.length > 0,
    },
    {
        id: 'validFrom',
        label: msg.value.review.checkValidFrom,
        ok: Boolean(props.version.validFrom),
    },
    {
        id: 'validFromOrder',
        label: props.predecessor
            ? formatMessage(msg.value.review.checkValidFromAfterPredecessor, {
                  version: props.predecessor.version,
              })
            : msg.value.review.checkValidFromAfterPrevious,
        ok: validFromAfterPredecessor.value,
    },
    {
        id: 'changeNote',
        label: msg.value.review.checkChangeNote,
        ok: Boolean(props.version.changeNote && props.version.changeNote.trim()),
    },
]);

const canPublish = computed(() => checks.value.every((c) => c.ok));

function onPublish(): void {
    if (!canPublish.value || props.publishing || props.saving) return;
    emit('publish', {
        forceRegressive: forceRegressive.value,
        allowZeroPrice: allowZeroPrice.value,
    });
}
</script>

<style scoped>
.pr {
    padding: 22px 26px;
    background: var(--sa-bg-app);
    min-height: 100%;
    box-sizing: border-box;
    font-family: var(--sa-font-body);
    color: var(--sa-body);
}
.pr * {
    box-sizing: border-box;
}
.pr-mono {
    font-family: var(--sa-font-mono);
    font-weight: 600;
}

.pr-head {
    display: flex;
    align-items: flex-end;
    gap: 20px;
    margin-bottom: 16px;
}
.pr-head-text {
    flex: 1;
    min-width: 0;
}
.pr-title {
    font: 700 22px/1.2 var(--sa-font-head);
    letter-spacing: -0.02em;
    color: var(--sa-heading);
    margin: 0;
}
.pr-sub {
    font-size: 12.5px;
    color: var(--sa-muted);
    margin: 4px 0 0;
}
.pr-head-actions {
    display: flex;
    gap: 8px;
}

.pr-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    border-radius: 7px;
    font: 500 13px var(--sa-font-body);
    cursor: pointer;
    border: 1px solid var(--sa-border);
    background: var(--sa-bg-surface);
    color: var(--sa-heading);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.pr-btn:hover:not(:disabled) {
    background: var(--sa-border-soft);
}
.pr-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
.pr-btn--primary {
    background: var(--sa-primary);
    border-color: var(--sa-primary);
    color: #fff;
}
.pr-btn--primary:hover:not(:disabled) {
    filter: brightness(0.94);
}
.pr-ico--back {
    display: inline-flex;
    transform: rotate(180deg);
}

.pr-banner {
    background: var(--sa-warning-soft);
    border: 1px solid var(--sa-amber-border);
    color: var(--sa-warning);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 12.5px;
    margin-bottom: 14px;
}

.pr-grid {
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 16px;
    align-items: start;
}
.pr-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.pr-card {
    background: var(--sa-bg-surface);
    border: 1px solid var(--sa-border);
    border-radius: 10px;
    padding: 16px 20px;
}
.pr-card--regress {
    background: var(--sa-warning-soft);
    border-color: var(--sa-amber-border);
}
.pr-card--impact {
    background: linear-gradient(180deg, var(--sa-primary-soft) 0%, var(--sa-bg-surface) 100%);
    border-color: var(--sa-primary-border);
}
.pr-card-title {
    font: 700 14px var(--sa-font-head);
    letter-spacing: -0.01em;
    color: var(--sa-heading);
    margin: 0 0 12px;
}
.pr-req {
    color: var(--sa-negative);
}
.pr-card-hint {
    font-size: 11.5px;
    color: var(--sa-muted);
    margin: -6px 0 10px;
    line-height: 1.5;
}

.pr-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--sa-border-soft);
}
.pr-row:last-child {
    border-bottom: 0;
}
.pr-label {
    font-size: 12px;
    color: var(--sa-muted);
    min-width: 130px;
}
.pr-val {
    font-size: 13px;
    color: var(--sa-heading);
    font-weight: 500;
}
.pr-missing {
    color: var(--sa-muted);
    font-weight: 400;
}
.pr-inf {
    color: var(--sa-positive);
    font-weight: 600;
}

.pr-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    border: 1px solid;
}
.pr-chip--live {
    background: var(--sa-positive-soft);
    color: var(--sa-positive);
    border-color: rgba(4, 120, 87, 0.3);
}
.pr-chip--muted {
    background: var(--sa-border-soft);
    color: var(--sa-muted);
    border-color: var(--sa-border);
}

.pr-components {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
}
.pr-comp-head {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    margin-bottom: 6px;
}
.pr-comp-head--quota {
    color: #0ea5e9;
}
.pr-comp-head--feature {
    color: #8b5cf6;
}
.pr-comp-head--bundle {
    color: var(--sa-amber);
}
.pr-comp-item {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-size: 12px;
    padding: 3px 0;
    border-bottom: 1px solid var(--sa-border-soft);
    color: var(--sa-body);
}
.pr-comp-item b {
    color: var(--sa-heading);
}
.pr-comp-empty {
    font-size: 12px;
    color: var(--sa-muted);
    font-style: italic;
    padding: 3px 0;
}

.pr-note {
    font-size: 13px;
    line-height: 1.55;
    color: var(--sa-body);
    background: var(--sa-border-soft);
    border-radius: 7px;
    padding: 10px 12px;
}
.pr-note--missing {
    background: var(--sa-warning-soft);
    color: var(--sa-warning);
}

.pr-checks {
    display: flex;
    flex-direction: column;
    gap: 7px;
}
.pr-check {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 12.5px;
}
.pr-check--ok {
    color: var(--sa-heading);
}
.pr-check--warn {
    color: var(--sa-warning);
}
.pr-check-mark {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}
.pr-check--ok .pr-check-mark {
    background: var(--sa-positive-soft);
    color: var(--sa-positive);
}
.pr-check--warn .pr-check-mark {
    background: var(--sa-warning-soft);
    color: var(--sa-warning);
}

.pr-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
    color: var(--sa-heading);
    cursor: pointer;
}

.pr-impact {
    display: flex;
    gap: 16px;
    align-items: center;
}
.pr-impact-num {
    font: 700 40px/1 var(--sa-font-head);
    letter-spacing: -0.03em;
    color: var(--sa-heading);
}
.pr-impact-text {
    font-size: 12.5px;
    color: var(--sa-body);
    line-height: 1.5;
}

@media (max-width: 1100px) {
    .pr-grid {
        grid-template-columns: 1fr;
    }
    .pr-components {
        grid-template-columns: 1fr;
    }
}
</style>

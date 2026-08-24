<template>
    <AdminSection>
        <AdminStatistics :columns="4">
            <AdminKpi :label="msg.matrix.statPlans" :value="plans.length" />
            <AdminKpi :label="msg.matrix.statFeatures" :value="orderedFeatureKeys.length" />
            <AdminKpi :label="msg.matrix.statQuotas" :value="orderedQuotaKeys.length" />
            <AdminKpi :label="msg.matrix.statBundles" :value="orderedBundleKeys.length" />
        </AdminStatistics>
    </AdminSection>

    <AdminSection>
        <div class="pm-wrap">
            <table class="pm-table">
                <thead>
                    <tr class="pm-head">
                        <th class="pm-rowhead-cell">
                            <span class="pm-component-kicker">{{
                                msg.matrix.componentColumn
                            }}</span>
                        </th>
                        <th v-for="p in resolvedPlans" :key="p.planKey" class="pm-plan-head">
                            <div
                                class="pm-plan-card"
                                :style="{ borderTopColor: planAccent(p.planKey) }"
                            >
                                <div class="pm-plan-top">
                                    <div>
                                        <div class="pm-plan-key">{{ p.planKey }}</div>
                                        <div class="pm-plan-label">{{ p.label }}</div>
                                    </div>
                                    <q-btn
                                        class="pm-kebab"
                                        flat
                                        dense
                                        size="sm"
                                        icon="more_horiz"
                                        @click="$emit('openPlan', p.plan)"
                                    />
                                </div>
                                <div class="pm-plan-desc">{{ p.description || NBSP }}</div>
                                <div class="pm-plan-divider" />

                                <div class="pm-status-row">
                                    <span
                                        v-if="p.live"
                                        class="pm-chip pm-chip--live pm-chip--dot"
                                        >{{ liveVersionLabel(p.live.version) }}</span
                                    >
                                    <span v-else class="pm-chip pm-chip--supersed pm-chip--dot">{{
                                        msg.matrix.chipNoLive
                                    }}</span>
                                    <span
                                        v-if="p.draft"
                                        class="pm-chip pm-chip--draft pm-chip--dot"
                                    >
                                        {{ draftVersionLabel(p.draft.version) }}
                                    </span>
                                </div>

                                <div class="pm-price">
                                    <template
                                        v-if="
                                            p.live &&
                                            Number(p.live.monthlyNet) === 0 &&
                                            Number(p.live.yearlyNet) === 0
                                        "
                                    >
                                        <span class="pm-price-free">{{
                                            msg.matrix.priceFree
                                        }}</span>
                                    </template>
                                    <template v-else-if="p.live">
                                        <span class="pm-price-big">{{
                                            formatMoney(p.live.monthlyNet)
                                        }}</span>
                                        <span class="pm-price-unit">{{
                                            msg.matrix.perMonthShort
                                        }}</span>
                                        <span class="pm-price-yearly"
                                            >·
                                            {{
                                                formatMoney(p.live.yearlyNet) +
                                                msg.matrix.perYearShort
                                            }}</span
                                        >
                                    </template>
                                    <template v-else-if="p.draft">
                                        <span class="pm-price-big">{{
                                            formatMoney(p.draft.monthlyNet)
                                        }}</span>
                                        <span class="pm-price-unit">{{
                                            msg.matrix.perMonthShort
                                        }}</span>
                                        <span class="pm-price-yearly">{{
                                            msg.matrix.priceDraftMarker
                                        }}</span>
                                    </template>
                                    <template v-else>
                                        <span class="pm-price-free">{{ msg.matrix.noPrices }}</span>
                                    </template>
                                </div>

                                <div class="pm-plan-meta">
                                    <span>{{ tenantCountLabel(p.tenantCount) }}</span>
                                    <template v-if="p.live?.validFrom">
                                        <span>·</span>
                                        <span>{{ validFromLabel(p.live.validFrom) }}</span>
                                    </template>
                                    <span
                                        :class="[
                                            'pm-chip pm-chip--tiny',
                                            p.live?.marketed ? '' : 'pm-chip--supersed',
                                        ]"
                                    >
                                        {{
                                            p.live?.marketed
                                                ? msg.matrix.inCatalog
                                                : msg.matrix.private
                                        }}
                                    </span>
                                </div>

                                <div class="pm-plan-actions">
                                    <q-btn
                                        flat
                                        dense
                                        no-caps
                                        :label="common.open"
                                        @click="$emit('openPlan', p.plan)"
                                    />
                                    <q-btn
                                        flat
                                        dense
                                        no-caps
                                        :aria-label="msg.matrix.clonePlan"
                                        @click="$emit('clonePlan', p.plan)"
                                    >
                                        <q-icon name="content_copy" size="12px" />
                                    </q-btn>
                                </div>
                            </div>
                        </th>
                        <th class="pm-add-col">
                            <!-- @optionSurface
                                 The empty cell that adds a component to the matrix: a drop target the
                                 size of the cell, not a button placed in one. -->
                            <button class="pm-add" type="button" @click="$emit('createPlan')">
                                <div class="pm-add-icon">
                                    <q-icon name="add" size="14px" />
                                </div>
                                <div class="pm-add-title">{{ msg.matrix.createPlan }}</div>
                                <div class="pm-add-sub">{{ msg.matrix.createPlanSub }}</div>
                            </button>
                        </th>
                    </tr>
                </thead>

                <tbody>
                    <!-- Quotas section -->
                    <tr class="pm-group">
                        <td :colspan="resolvedPlans.length + 2">
                            <div class="pm-group-inner">
                                <span class="pm-group-dot pm-group-dot--quota" />
                                <span>{{ msg.matrix.groupQuotas }}</span>
                                <span class="pm-group-count">{{ orderedQuotaKeys.length }}</span>
                            </div>
                        </td>
                    </tr>
                    <tr v-for="qKey in orderedQuotaKeys" :key="`q-${qKey}`" class="pm-row">
                        <td class="pm-rowhead">
                            <div class="pm-rowhead-inner">
                                <div class="pm-rh-label">{{ quotaLabel(qKey) }}</div>
                                <code class="pm-rh-key">{{ qKey }}</code>
                            </div>
                        </td>
                        <td
                            v-for="p in resolvedPlans"
                            :key="`q-${qKey}-${p.planKey}`"
                            :class="[
                                'pm-cell',
                                'pm-cell--val',
                                isDraftSource(p) ? 'pm-cell--draftsrc' : '',
                            ]"
                        >
                            <div v-if="quotaValueFor(p, qKey) !== undefined" class="pm-quota">
                                <span class="pm-num">{{
                                    formatQuota(quotaValueFor(p, qKey))
                                }}</span>
                                <span v-if="quotaUnit(qKey)" class="pm-unit">{{
                                    quotaUnit(qKey)
                                }}</span>
                            </div>
                            <span v-else class="pm-dash">—</span>
                        </td>
                        <td />
                    </tr>

                    <!-- Features section -->
                    <tr class="pm-group">
                        <td :colspan="resolvedPlans.length + 2">
                            <div class="pm-group-inner">
                                <span class="pm-group-dot pm-group-dot--feature" />
                                <span>{{ msg.matrix.groupFeatures }}</span>
                                <span class="pm-group-count">{{ orderedFeatureKeys.length }}</span>
                            </div>
                        </td>
                    </tr>
                    <tr v-for="fKey in orderedFeatureKeys" :key="`f-${fKey}`" class="pm-row">
                        <td class="pm-rowhead">
                            <div class="pm-rowhead-inner">
                                <div class="pm-rh-label">{{ featureLabel(fKey) }}</div>
                                <code class="pm-rh-key">{{ fKey }}</code>
                            </div>
                        </td>
                        <!-- Core features are base infrastructure: included in every
                             plan, so no per-plan checkmark but a single
                             "Basis" badge across all plan columns. -->
                        <td
                            v-if="isCoreFeature(fKey)"
                            class="pm-cell pm-cell--base"
                            :colspan="resolvedPlans.length"
                        >
                            <span class="pm-base-badge">
                                <q-icon name="check" size="11px" />
                                {{ msg.matrix.baseBadge }}
                            </span>
                        </td>
                        <template v-else>
                            <td
                                v-for="p in resolvedPlans"
                                :key="`f-${fKey}-${p.planKey}`"
                                :class="[
                                    'pm-cell',
                                    hasFeature(p, fKey) ? 'pm-cell--ok' : 'pm-cell--no',
                                    isDraftSource(p) ? 'pm-cell--draftsrc' : '',
                                ]"
                            >
                                <span
                                    v-if="hasFeature(p, fKey)"
                                    class="pm-check"
                                    :style="identityChipStyle(planAccent(p.planKey))"
                                >
                                    <q-icon name="check" size="12px" />
                                </span>
                                <span v-else class="pm-dash">—</span>
                            </td>
                        </template>
                        <td />
                    </tr>

                    <!-- Bundles section -->
                    <tr v-if="orderedBundleKeys.length > 0" class="pm-group">
                        <td :colspan="resolvedPlans.length + 2">
                            <div class="pm-group-inner">
                                <span class="pm-group-dot pm-group-dot--bundle" />
                                <span>{{ msg.matrix.groupBundles }}</span>
                                <span class="pm-group-count">{{ orderedBundleKeys.length }}</span>
                            </div>
                        </td>
                    </tr>
                    <tr v-for="bKey in orderedBundleKeys" :key="`b-${bKey}`" class="pm-row">
                        <td class="pm-rowhead">
                            <div class="pm-rowhead-inner">
                                <div class="pm-rh-label">{{ bundleLabel(bKey) }}</div>
                                <code class="pm-rh-key">{{ bKey }}</code>
                            </div>
                        </td>
                        <td
                            v-for="p in resolvedPlans"
                            :key="`b-${bKey}-${p.planKey}`"
                            :class="[
                                'pm-cell',
                                hasBundle(p, bKey) ? 'pm-cell--ok' : 'pm-cell--no',
                                isDraftSource(p) ? 'pm-cell--draftsrc' : '',
                            ]"
                        >
                            <span
                                v-if="hasBundle(p, bKey)"
                                class="pm-check"
                                :style="identityChipStyle(planAccent(p.planKey))"
                            >
                                <q-icon name="check" size="12px" />
                            </span>
                            <span v-else class="pm-dash">—</span>
                        </td>
                        <td />
                    </tr>
                </tbody>
            </table>
        </div>

        <div class="pm-legend">
            <span class="pm-legend-item">
                <span class="pm-legend-check"><q-icon name="check" size="10px" /></span>
                {{ msg.matrix.legendIncluded }}
            </span>
            <span class="pm-legend-item">
                <span class="pm-legend-dash">—</span>
                {{ msg.matrix.legendNotIncluded }}
            </span>
            <span v-if="loading" class="pm-legend-loading">{{ msg.matrix.legendLoading }}</span>
        </div>
    </AdminSection>
</template>

<script setup lang="ts">
import AdminKpi from '../../ui/data/AdminKpi.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import AdminStatistics from '../../ui/data/AdminStatistics.vue';
import { computed } from 'vue';

/**
 * Placeholder for an empty plan description. A non-breaking space keeps the
 * row height stable across the matrix columns; written as an escape because a
 * literal U+00A0 is invisible in a diff.
 */
const NBSP = '\u00A0';
import type { PlanRow, PlanVersionRow } from '@saasicat/core';
import { identityAccentFor, identityChipStyle } from '../../client/identity-accents.js';
import { formatMessage } from '../../client/i18n/format.js';
import { formatCurrency } from '../../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// PlanMatrix — V1 matrix overview. Plans as columns, quotas/features/
// bundles as rows. Expects the plan master list plus, per plan, the
// mapping to its plan versions (live + draft). The data comes from the
// consumer (PlansPage), which loads per plan via usePlanVersions.

interface BundleEntry {
    bundleKey: string;
    label?: string | null;
    features: string[];
    /** Plan keys for which the bundle is bookable (empty/missing = all plans).
     *  Source: BundleVersion.compatibility.planIds — contains plan KEYS. */
    compatiblePlanKeys?: string[] | null;
}

interface DiscoveryQuota {
    quotaKey: string;
    label?: string | null;
    unit?: string | null;
}

interface FeatureMeta {
    label?: string;
    /** true = base infrastructure, included in every plan (not bookable per plan). */
    core?: boolean;
}

const props = withDefaults(
    defineProps<{
        plans: PlanRow[];
        /** Versions per plan (id → PlanVersionRow[]). */
        versionsByPlanId: Record<string, PlanVersionRow[]>;
        /** Discovery quotas (for labels + units). */
        availableQuotas?: DiscoveryQuota[];
        /** Bundles for the bundle section. */
        availableBundles?: BundleEntry[];
        /** Feature label map. */
        featureRegistry?: Record<string, FeatureMeta>;
        /** Tenant count per planKey (for the plan header). */
        tenantCountsByPlanKey?: Record<string, number>;
        /** Accent color per planKey for card top border + check badge. */
        planAccents?: Record<string, string>;
        loading?: boolean;
    }>(),
    {
        availableQuotas: () => [],
        availableBundles: () => [],
        featureRegistry: () => ({}),
        tenantCountsByPlanKey: () => ({}),
        planAccents: () => ({}),
        loading: false,
    },
);

defineEmits<{
    (e: 'openPlan', plan: PlanRow): void;
    (e: 'clonePlan', plan: PlanRow): void;
    (e: 'createPlan'): void;
}>();

interface ResolvedPlan {
    plan: PlanRow;
    planKey: string;
    label: string;
    description: string | null;
    live: PlanVersionRow | null;
    draft: PlanVersionRow | null;
    tenantCount: number;
}

const msg = useSaMessages('plans');
const { locale, intlLocale } = useSuperAdminI18n();
const common = useSaMessages('common');

function liveVersionLabel(version: number): string {
    return formatMessage(msg.value.matrix.chipLiveVersion, { version });
}

function draftVersionLabel(version: number): string {
    return formatMessage(msg.value.matrix.chipDraftVersion, { version });
}

function tenantCountLabel(count: number): string {
    return formatMessage(msg.value.matrix.tenantCount, { count });
}

function validFromLabel(validFrom: string): string {
    return formatMessage(msg.value.matrix.validFrom, { date: validFrom.slice(0, 10) });
}

function planAccent(planKey: string): string {
    return identityAccentFor(
        planKey,
        props.planAccents,
        props.plans.findIndex((p) => p.planKey === planKey),
    );
}

const resolvedPlans = computed<ResolvedPlan[]>(() =>
    [...props.plans]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.planKey.localeCompare(b.planKey))
        .map((plan) => {
            const versions = props.versionsByPlanId[plan.id] ?? [];
            const live =
                versions.find((v) => v.publishedAt !== null && v.supersededAt === null) ?? null;
            const draft = versions.find((v) => v.publishedAt === null) ?? null;
            return {
                plan,
                planKey: plan.planKey,
                label: plan.label,
                description: plan.description ?? null,
                live,
                draft,
                tenantCount: props.tenantCountsByPlanKey[plan.planKey] ?? 0,
            };
        }),
);

function quotasOf(v: PlanVersionRow | null): Record<string, number> {
    if (!v) return {};
    if (v.quotas && Object.keys(v.quotas).length > 0) return v.quotas;
    const legacy: Record<string, number> = {};
    if (typeof v.maxUsers === 'number') legacy.users = v.maxUsers;
    if (typeof v.maxVehicles === 'number') legacy.vehicles = v.maxVehicles;
    if (typeof v.maxStorageGb === 'number') legacy.storageGb = v.maxStorageGb;
    return legacy;
}

/**
 * Effective version of a column: live, otherwise draft. This lets the
 * matrix also render pure draft plans (initial population before the first
 * publish); draft columns are visually marked via `isDraftSource`.
 */
function effectiveOf(p: ResolvedPlan): PlanVersionRow | null {
    return p.live ?? p.draft;
}

function isDraftSource(p: ResolvedPlan): boolean {
    return !p.live && !!p.draft;
}

function quotaValueFor(p: ResolvedPlan, key: string): number | undefined {
    const q = quotasOf(effectiveOf(p));
    return Object.prototype.hasOwnProperty.call(q, key) ? q[key] : undefined;
}

const orderedQuotaKeys = computed<string[]>(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const q of props.availableQuotas) {
        if (!seen.has(q.quotaKey)) {
            seen.add(q.quotaKey);
            ordered.push(q.quotaKey);
        }
    }
    for (const p of resolvedPlans.value) {
        for (const k of Object.keys(quotasOf(effectiveOf(p)))) {
            if (!seen.has(k)) {
                seen.add(k);
                ordered.push(k);
            }
        }
    }
    return ordered;
});

const orderedFeatureKeys = computed<string[]>(() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const key of Object.keys(props.featureRegistry)) {
        if (!seen.has(key)) {
            seen.add(key);
            ordered.push(key);
        }
    }
    for (const p of resolvedPlans.value) {
        const version = effectiveOf(p);
        if (!version) continue;
        for (const f of version.features) {
            if (!seen.has(f)) {
                seen.add(f);
                ordered.push(f);
            }
        }
    }
    // Staircase sorting: first the features with the broadest plan coverage;
    // on a tie the ones already included in the cheaper plans
    // (left columns) win — this is how the staircase forms. Features without
    // any assignment land at the bottom; within the same tiers alphabetically.
    const presence = new Map<string, { count: number; mask: string }>();
    for (const key of ordered) {
        let count = 0;
        let mask = '';
        for (const p of resolvedPlans.value) {
            const has = hasFeature(p, key);
            mask += has ? '1' : '0';
            if (has) count += 1;
        }
        presence.set(key, { count, mask });
    }
    return ordered.sort((a, b) => {
        const pa = presence.get(a)!;
        const pb = presence.get(b)!;
        if (pa.count !== pb.count) return pb.count - pa.count;
        if (pa.mask !== pb.mask) return pb.mask.localeCompare(pa.mask);
        return featureLabel(a).localeCompare(featureLabel(b), intlLocale.value);
    });
});

const orderedBundleKeys = computed<string[]>(() => props.availableBundles.map((b) => b.bundleKey));

function quotaLabel(key: string): string {
    return props.availableQuotas.find((q) => q.quotaKey === key)?.label || key;
}
function quotaUnit(key: string): string {
    return props.availableQuotas.find((q) => q.quotaKey === key)?.unit || '';
}
function featureLabel(key: string): string {
    return props.featureRegistry[key]?.label ?? key;
}
function isCoreFeature(key: string): boolean {
    return props.featureRegistry[key]?.core === true;
}
function bundleLabel(key: string): string {
    return props.availableBundles.find((b) => b.bundleKey === key)?.label || key;
}

function hasFeature(p: ResolvedPlan, fKey: string): boolean {
    const version = effectiveOf(p);
    return !!version && version.features.includes(fKey);
}

function hasBundle(p: ResolvedPlan, bKey: string): boolean {
    const bundle = props.availableBundles.find((b) => b.bundleKey === bKey);
    if (!bundle) return false;
    // Availability = plan compatibility of the bundle (empty = all plans).
    // Previously wrongly "all bundle features included in the plan" → a bundle
    // restricted to one plan thereby appeared for ALL plans.
    const compat = bundle.compatiblePlanKeys ?? [];
    return compat.length === 0 || compat.includes(p.planKey);
}

function formatMoney(raw: string | number): string {
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return String(raw);
    return formatCurrency(num, locale.value);
}

function formatQuota(v: number | undefined): string {
    if (v === undefined) return '—';
    if (v === -1) return '∞';
    return String(v);
}
</script>

<style scoped>
.pm-wrap {
    overflow: auto;
}

.pm-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: var(--sa-text-md);
}
.pm-head th {
    background: var(--sa-color-bg-surface-raised);
    border-bottom: 1px solid var(--sa-color-border);
}
.pm-rowhead-cell {
    text-align: left;
    padding: var(--sa-space-4) var(--sa-space-5);
    vertical-align: bottom;
    width: 280px;
    min-width: 240px;
}
.pm-component-kicker {
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-subtle);
    font-weight: 700;
}

.pm-plan-head {
    padding: var(--sa-space-4) var(--sa-space-3);
    vertical-align: top;
    min-width: 200px;
}
.pm-plan-card {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-top: 3px solid;
    border-radius: var(--sa-radius-tile);
    padding: var(--sa-space-4) var(--sa-space-4) var(--sa-space-4);
    display: flex;
    flex-direction: column;
}
.pm-plan-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}
.pm-plan-key {
    font: 700 var(--sa-text-xs) var(--sa-font-mono);
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-secondary);
}
.pm-plan-label {
    font-size: var(--sa-text-xl);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-tight);
    color: var(--sa-color-fg-heading);
}
.pm-plan-desc {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-2);
    line-height: 1.4;
    min-height: 32px;
}
.pm-plan-divider {
    height: 1px;
    background: var(--sa-color-border);
    margin: var(--sa-space-3) 0;
}
.pm-kebab {
    background: none;
    border: 0;
    color: var(--sa-color-fg-subtle);
    cursor: pointer;
    font-size: var(--sa-text-lg);
    padding: 0;
    line-height: 1;
}
.pm-status-row {
    display: flex;
    gap: var(--sa-space-2);
    align-items: center;
    flex-wrap: wrap;
}
.pm-price {
    display: flex;
    align-items: baseline;
    gap: var(--sa-space-2);
    margin-top: var(--sa-space-3);
    flex-wrap: wrap;
}
.pm-price-big {
    font-size: var(--sa-text-xl);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-tight);
}
.pm-price-unit {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
}
.pm-price-yearly {
    font-size: var(--sa-text-2xs);
    color: var(--sa-color-fg-subtle);
    margin-left: var(--sa-space-2);
}
.pm-price-free {
    font-size: var(--sa-text-lg);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.pm-plan-meta {
    display: flex;
    gap: var(--sa-space-2);
    flex-wrap: wrap;
    align-items: center;
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
    margin-top: var(--sa-space-3);
}
.pm-plan-actions {
    display: flex;
    gap: var(--sa-space-2);
    margin-top: var(--sa-space-3);
    padding-top: var(--sa-space-3);
    border-top: 1px solid var(--sa-color-border-soft);
}

.pm-add-col {
    width: 130px;
    padding: var(--sa-space-4) var(--sa-space-3);
    vertical-align: top;
}
.pm-add {
    border: 1.5px dashed var(--sa-color-scheduled-border);
    border-radius: var(--sa-radius-tile);
    padding: var(--sa-space-5) var(--sa-space-3);
    background: var(--sa-color-accent-surface);
    text-align: center;
    cursor: pointer;
    min-height: 180px;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    font-family: inherit;
}
.pm-add:hover {
    background: var(--sa-color-scheduled-surface);
    border-color: var(--sa-color-scheduled-strong);
}
.pm-add-icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--sa-color-accent-surface-strong);
    color: var(--sa-color-accent-strong);
    margin: 0 auto var(--sa-space-2);
}
/* On the tinted card, not on the page: `accent` and `fg-subtle` are chosen
 * against `bg-app`, and reading them on `accent-surface` gave 2.0:1 and 2.5:1.
 * The `-strong` rung is the theme's answer for text on its own tint — the icon
 * above already used it. */
.pm-add-title {
    font-size: var(--sa-text-sm);
    font-weight: 600;
    color: var(--sa-color-accent-strong);
}
.pm-add-sub {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-body);
    margin-top: var(--sa-space-1);
}

/* Chips */
.pm-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    font-size: var(--sa-text-xs);
    font-weight: 600;
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-secondary);
    border: 1px solid var(--sa-color-border);
}
.pm-chip--tiny {
    padding: var(--sa-space-0) var(--sa-space-2);
    font-size: var(--sa-text-2xs);
}
.pm-chip--live {
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive-fg);
    border-color: var(--sa-color-positive-border);
}
.pm-chip--draft {
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    border-color: var(--sa-color-warning-border);
}
.pm-chip--supersed {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    border-color: var(--sa-color-border-strong);
}
.pm-chip--dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

/* Group rows */
.pm-group td {
    background: var(--sa-color-bg-sunken);
    border-top: 1px solid var(--sa-color-border);
    border-bottom: 1px solid var(--sa-color-border);
}
.pm-group-inner {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-5);
    font-size: var(--sa-text-xs);
    font-weight: 700;
    letter-spacing: var(--sa-tracking-wider);
    text-transform: uppercase;
    color: var(--sa-color-fg-secondary);
}
.pm-group-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
}
.pm-group-dot--quota {
    background: var(--sa-color-quota);
}
.pm-group-dot--feature {
    background: var(--sa-color-feature);
}
.pm-group-dot--bundle {
    background: var(--sa-color-bundle);
}
.pm-group-count {
    background: var(--sa-color-border);
    color: var(--sa-color-fg-secondary);
    padding: var(--sa-space-0) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    font-size: var(--sa-text-2xs);
}

/* Data rows */
.pm-row td {
    border-bottom: 1px solid var(--sa-color-border-soft);
    height: 44px;
}
.pm-row:hover td {
    background: var(--sa-color-bg-surface-raised);
}
.pm-rowhead {
    padding: var(--sa-space-3) var(--sa-space-5);
}
.pm-rowhead-inner {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-0);
}
.pm-rh-label {
    font-size: var(--sa-text-md);
    font-weight: 500;
    color: var(--sa-color-fg-heading);
}
.pm-rh-key {
    font: 500 var(--sa-text-2xs) var(--sa-font-mono);
    color: var(--sa-color-fg-subtle);
}
.pm-cell {
    text-align: center;
    padding: var(--sa-space-3) var(--sa-space-4);
    vertical-align: middle;
}
/* Column sources from an unpublished draft (no live). */
.pm-cell--draftsrc {
    opacity: 0.62;
    background-image: repeating-linear-gradient(
        135deg,
        transparent 0 6px,
        var(--sa-color-warning-surface) 6px 7px
    );
}
.pm-cell--base {
    text-align: center;
    background: var(--sa-color-bg-sunken);
}
.pm-base-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-1) var(--sa-space-4);
    border-radius: var(--sa-radius-pill);
    font-size: var(--sa-text-xs);
    font-weight: 600;
    letter-spacing: var(--sa-tracking-wide);
    background: var(--sa-color-scheduled-surface);
    color: var(--sa-color-scheduled-fg);
    border: 1px solid var(--sa-color-scheduled-border);
}
.pm-check {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--sa-radius-badge);
}
/* The dash is the cell's whole content — it says "not in this plan" — so it is
 * text, not a disabled control. `fg-disabled` rendered it at 1.48:1, which is
 * the contrast of something meant to be ignored. */
.pm-dash {
    color: var(--sa-color-fg-muted);
    font-weight: 500;
}
.pm-num {
    font: 600 var(--sa-text-lg) var(--sa-font-body);
    color: var(--sa-color-fg-heading);
}
.pm-unit {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    margin-left: var(--sa-space-1);
}
.pm-quota {
    display: flex;
    align-items: baseline;
    justify-content: center;
}

/* Legend */
.pm-legend {
    display: flex;
    gap: var(--sa-space-5);
    margin-top: var(--sa-space-4);
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
    align-items: center;
}
.pm-legend-item {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
}
.pm-legend-check {
    width: 14px;
    height: 14px;
    border-radius: var(--sa-radius-badge);
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive);
    display: grid;
    place-items: center;
}
.pm-legend-dash {
    width: 14px;
    height: 14px;
    color: var(--sa-color-fg-muted);
    display: grid;
    place-items: center;
    font-size: var(--sa-text-lg);
    line-height: 1;
}
.pm-legend-loading {
    margin-left: auto;
    font-style: italic;
    color: var(--sa-color-fg-subtle);
}
</style>

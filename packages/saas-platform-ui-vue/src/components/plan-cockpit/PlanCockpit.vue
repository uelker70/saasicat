<template>
    <div class="pc">
        <PlanCockpitHeader
            :plan="plan"
            :accent-bg="accentBg"
            :accent-fg="accentFg"
            :has-open-draft="hasOpenDraft"
            @back="$emit('back')"
            @clone-plan="$emit('clonePlan')"
            @view-catalog="$emit('viewCatalog')"
            @create-draft="$emit('createDraft')"
        />

        <PlanCockpitKpis
            :live-version="liveVersion"
            :tenant-impact-total="tenantImpactTotal"
            :versions-count="versions.length"
            :published-count="publishedCount"
            :draft-count="draftCount"
            :draft-version="draftVersion"
        />

        <!-- Two columns -->
        <div class="pc-grid">
            <PlanCockpitVersions
                :versions="versions"
                :sorted-versions="sortedVersions"
                :timeline-segments="timelineSegments"
                :timeline-axis="timelineAxis"
                :has-open-draft="hasOpenDraft"
                :next-draft-version="nextDraftVersion"
                :impact-by-version="impactByVersion"
                :draft-version="draftVersion"
                @create-draft="$emit('createDraft')"
                @publish="$emit('publish', $event)"
                @edit-draft="$emit('editDraft', $event)"
                @view-diff="forwardViewDiff"
            />

            <!-- RIGHT — Diff + Impact -->
            <div class="pc-right-col">
                <PlanCockpitDiffPanel :diff-pair="diffPair" :diff="diff" :diff-rows="diffRows" />

                <PlanCockpitImpactPanel
                    :tenant-impact="tenantImpact"
                    :tenant-impact-total="tenantImpactTotal"
                />
            </div>
        </div>

        <PlanCockpitAuditLog :audit-rows="auditRows" :loading-audit="loadingAudit" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PlanRow, PlanVersionRow } from '@saasicat/types';
import PlanCockpitAuditLog from './PlanCockpitAuditLog.vue';
import PlanCockpitDiffPanel from './PlanCockpitDiffPanel.vue';
import PlanCockpitHeader from './PlanCockpitHeader.vue';
import PlanCockpitImpactPanel from './PlanCockpitImpactPanel.vue';
import PlanCockpitKpis from './PlanCockpitKpis.vue';
import PlanCockpitVersions from './PlanCockpitVersions.vue';
import type {
    AuditRow,
    DiffRow,
    DiffSummary,
    DiscoveryQuota,
    FeatureMeta,
    PlanVersionPair,
    TenantImpact,
    TimelineSegment,
} from './types';

// PlanCockpit — V3 drill-in for a single plan: version timeline,
// diff draft→live, tenant impact, audit log. Data comes from the consumer
// (PlansPage). The diff is computed locally from two PlanVersionRows.

const props = withDefaults(
    defineProps<{
        plan: PlanRow;
        versions: PlanVersionRow[];
        /** Accent color for the plan header. */
        accent?: string;
        /** Optional: tenant impact data for the publish preview. */
        tenantImpact?: TenantImpact | null;
        /** Tenant count per version (for the "Impact" column in the versions table). */
        impactByVersion?: Record<number, number>;
        /** Audit log entries for this plan. */
        auditRows?: AuditRow[];
        loadingAudit?: boolean;
        /** Discovery quotas (for diff labels). */
        availableQuotas?: DiscoveryQuota[];
        featureRegistry?: Record<string, FeatureMeta>;
    }>(),
    {
        accent: '#2563eb',
        tenantImpact: null,
        impactByVersion: () => ({}),
        auditRows: () => [],
        loadingAudit: false,
        availableQuotas: () => [],
        featureRegistry: () => ({}),
    },
);

const emit = defineEmits<{
    (e: 'back'): void;
    (e: 'createDraft'): void;
    (e: 'editDraft', version: PlanVersionRow): void;
    (e: 'publish', version: PlanVersionRow): void;
    (e: 'clonePlan'): void;
    (e: 'viewCatalog'): void;
    (e: 'viewDiff', from: PlanVersionRow, to: PlanVersionRow): void;
}>();

function forwardViewDiff(from: PlanVersionRow, to: PlanVersionRow): void {
    emit('viewDiff', from, to);
}

const accentBg = computed(() => hexToTint(props.accent, 0.15));
const accentFg = computed(() => props.accent);

function hexToTint(hex: string, opacity: number): string {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#dbeafe';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const sortedVersions = computed<PlanVersionRow[]>(() =>
    [...props.versions].sort((a, b) => b.version - a.version),
);

const liveVersion = computed<PlanVersionRow | null>(
    () => props.versions.find((v) => v.publishedAt !== null && v.supersededAt === null) ?? null,
);

const draftVersion = computed<PlanVersionRow | null>(
    () => props.versions.find((v) => v.publishedAt === null) ?? null,
);

const hasOpenDraft = computed(() => draftVersion.value !== null);

const publishedCount = computed(() => props.versions.filter((v) => v.publishedAt !== null).length);
const draftCount = computed(() => props.versions.filter((v) => v.publishedAt === null).length);

const nextDraftVersion = computed(() => {
    const max = props.versions.reduce((m, v) => Math.max(m, v.version), 0);
    return max + 1;
});

const tenantImpactTotal = computed(() => {
    if (props.tenantImpact) {
        return props.tenantImpact.auto + props.tenantImpact.review + props.tenantImpact.conflict;
    }
    return Object.values(props.impactByVersion).reduce((s, n) => s + n, 0);
});

// ── Timeline ────────────────────────────────────────────────────────
const timelineSegments = computed<TimelineSegment[]>(() => {
    return [...props.versions]
        .sort((a, b) => a.version - b.version)
        .map((v) => ({
            key: v.id,
            version: v.version,
            status:
                v.publishedAt === null ? 'draft' : v.supersededAt !== null ? 'supersed' : 'live',
            flex: 1,
        }));
});

const timelineAxis = computed(() => {
    const labels: string[] = [];
    for (const v of [...props.versions].sort((a, b) => a.version - b.version)) {
        if (v.validFrom) labels.push(v.validFrom.slice(0, 7));
    }
    labels.push('jetzt');
    return labels;
});

// ── Formatting ──────────────────────────────────────────────────────
function formatMoney(raw: string | number): string {
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return String(raw);
    if (Number.isInteger(num)) return `${num} €`;
    return `${num.toFixed(2).replace('.', ',')} €`;
}

// ── Diff ────────────────────────────────────────────────────────────
const diffPair = computed<PlanVersionPair | null>(() => {
    const to = draftVersion.value ?? sortedVersions.value[0] ?? null;
    if (!to) return null;
    const from = sortedVersions.value.find((v) => v.version < to.version && v.publishedAt !== null);
    if (!from || from.id === to.id) return null;
    return { from, to };
});

function quotasOf(v: PlanVersionRow): Record<string, number> {
    if (v.quotas && Object.keys(v.quotas).length > 0) return v.quotas;
    const legacy: Record<string, number> = {};
    if (typeof v.maxUsers === 'number') legacy.users = v.maxUsers;
    if (typeof v.maxVehicles === 'number') legacy.vehicles = v.maxVehicles;
    if (typeof v.maxStorageGb === 'number') legacy.storageGb = v.maxStorageGb;
    return legacy;
}

function featureLabel(key: string): string {
    return props.featureRegistry[key]?.label ?? key;
}
function quotaLabel(key: string): string {
    return props.availableQuotas.find((q) => q.quotaKey === key)?.label || key;
}
function quotaUnit(key: string): string {
    return props.availableQuotas.find((q) => q.quotaKey === key)?.unit || '';
}

const diff = computed<DiffSummary>(() => {
    if (!diffPair.value) {
        return {
            addedFeatures: [] as string[],
            removedFeatures: [] as string[],
            addedQuotas: [] as Array<{ key: string; value: number }>,
            removedQuotas: [] as Array<{ key: string; value: number }>,
            changedQuotas: [] as Array<{ key: string; from: number; to: number }>,
            priceChanged: false,
            priceFrom: '',
            priceTo: '',
        };
    }
    const { from, to } = diffPair.value;
    const addedFeatures = to.features.filter((f) => !from.features.includes(f));
    const removedFeatures = from.features.filter((f) => !to.features.includes(f));
    const fromQ = quotasOf(from);
    const toQ = quotasOf(to);
    const addedQuotas: Array<{ key: string; value: number }> = [];
    const removedQuotas: Array<{ key: string; value: number }> = [];
    const changedQuotas: Array<{ key: string; from: number; to: number }> = [];
    const keys = new Set([...Object.keys(fromQ), ...Object.keys(toQ)]);
    for (const k of keys) {
        const fv = fromQ[k];
        const tv = toQ[k];
        if (fv === undefined && tv !== undefined) addedQuotas.push({ key: k, value: tv });
        else if (fv !== undefined && tv === undefined) removedQuotas.push({ key: k, value: fv });
        else if (fv !== undefined && tv !== undefined && fv !== tv) {
            changedQuotas.push({ key: k, from: fv, to: tv });
        }
    }
    const priceChanged = from.monthlyNet !== to.monthlyNet || from.yearlyNet !== to.yearlyNet;
    return {
        addedFeatures,
        removedFeatures,
        addedQuotas,
        removedQuotas,
        changedQuotas,
        priceChanged,
        priceFrom: `${formatMoney(from.monthlyNet)} / Mo · ${formatMoney(from.yearlyNet)} / J`,
        priceTo: `${formatMoney(to.monthlyNet)} / Mo · ${formatMoney(to.yearlyNet)} / J`,
    };
});

const STYLES = {
    added: { bg: '#ecfdf5', border: '#a7f3d0', color: '#047857', sign: '+', tag: 'neu' },
    removed: { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c', sign: '−', tag: 'entfernt' },
    changed: { bg: '#fffbeb', border: '#fde68a', color: '#b45309', sign: '~', tag: 'geändert' },
} as const;

const diffRows = computed<DiffRow[]>(() => {
    const out: DiffRow[] = [];
    for (const f of diff.value.addedFeatures) {
        out.push({
            id: `add-f-${f}`,
            section: 'Features',
            label: featureLabel(f),
            sub: f,
            ...STYLES.added,
        });
    }
    for (const f of diff.value.removedFeatures) {
        out.push({
            id: `rem-f-${f}`,
            section: 'Features',
            label: featureLabel(f),
            sub: f,
            ...STYLES.removed,
        });
    }
    for (const q of diff.value.changedQuotas) {
        const unit = quotaUnit(q.key);
        out.push({
            id: `chg-q-${q.key}`,
            section: 'Quotas',
            label: quotaLabel(q.key),
            sub: q.key,
            from: `${q.from}${unit ? ' ' + unit : ''}`,
            to: `${q.to}${unit ? ' ' + unit : ''}`,
            ...STYLES.changed,
        });
    }
    for (const q of diff.value.addedQuotas) {
        const unit = quotaUnit(q.key);
        out.push({
            id: `add-q-${q.key}`,
            section: 'Quotas',
            label: quotaLabel(q.key),
            sub: q.key,
            to: `${q.value}${unit ? ' ' + unit : ''}`,
            ...STYLES.added,
        });
    }
    for (const q of diff.value.removedQuotas) {
        const unit = quotaUnit(q.key);
        out.push({
            id: `rem-q-${q.key}`,
            section: 'Quotas',
            label: quotaLabel(q.key),
            sub: q.key,
            from: `${q.value}${unit ? ' ' + unit : ''}`,
            ...STYLES.removed,
        });
    }
    if (diff.value.priceChanged) {
        out.push({
            id: 'chg-price',
            section: 'Preis',
            label: 'Jahres- + Monatspreis',
            from: diff.value.priceFrom,
            to: diff.value.priceTo,
            ...STYLES.changed,
        });
    }
    return out;
});
</script>

<style>
.pc {
    --pc-bg: #f6f7f9;
    --pc-surface: #ffffff;
    --pc-surface-2: #f8fafc;
    --pc-border: #e5e7eb;
    --pc-border-strong: #d1d5db;
    --pc-text: #0f172a;
    --pc-text-2: #475569;
    --pc-text-3: #94a3b8;
    --pc-primary: #2563eb;
    --pc-live: #10b981;
    --pc-live-bg: #ecfdf5;
    --pc-draft: #f59e0b;
    --pc-draft-bg: #fffbeb;
    --pc-supersed: #94a3b8;
    --pc-supersed-bg: #f1f5f9;
    --pc-font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --pc-font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

    padding: 18px 26px;
    background: var(--pc-bg);
    color: var(--pc-text);
    font-family: var(--pc-font-sans);
    min-height: 100%;
    box-sizing: border-box;
}
.pc * {
    box-sizing: border-box;
}
.pc-mono {
    font: 500 11px var(--pc-font-mono);
}
.pc-mono--xs {
    font-size: 10.5px;
    color: #64748b;
}

/* Header */
.pc-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 18px;
}
.pc-header-left {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1;
}
.pc-header-titles {
    min-width: 0;
}
.pc-header-right {
    display: flex;
    gap: 8px;
}
.pc-backbar {
    margin-bottom: 12px;
}
.pc-back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 6px 8px;
    border-radius: 7px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--pc-text-2);
    font: 500 13px var(--pc-font-sans);
    cursor: pointer;
    transition: background 0.12s;
}
.pc-back:hover {
    background: rgba(15, 23, 42, 0.05);
}
.pc-back-ico {
    display: inline-flex;
    transform: rotate(180deg);
}
.pc-bigchip {
    padding: 6px 12px;
    border-radius: 7px;
    font: 700 12px var(--pc-font-mono);
    letter-spacing: 0.06em;
}
.pc-h-title {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0;
}
.pc-h-sub {
    font-size: 12.5px;
    color: var(--pc-text-2);
    margin: 3px 0 0;
}

/* Buttons + chips */
.pc-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    border-radius: 7px;
    font: 500 13px var(--pc-font-sans);
    cursor: pointer;
    border: 1px solid var(--pc-border-strong);
    background: #fff;
    color: var(--pc-text);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.pc-btn:hover:not(:disabled) {
    background: var(--pc-surface-2);
}
.pc-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
}
.pc-btn--primary {
    background: var(--pc-primary);
    border-color: var(--pc-primary);
    color: #fff;
}
.pc-btn--primary:hover:not(:disabled) {
    background: #1d4ed8;
}
.pc-btn--sm {
    padding: 5px 9px;
    font-size: 12px;
    gap: 5px;
}

.pc-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: var(--pc-surface-2);
    color: var(--pc-text-2);
    border: 1px solid var(--pc-border);
}
.pc-chip--mid {
    vertical-align: middle;
    margin-left: 6px;
}
.pc-chip--live {
    background: var(--pc-live-bg);
    color: #047857;
    border-color: #a7f3d0;
}
.pc-chip--draft {
    background: var(--pc-draft-bg);
    color: #b45309;
    border-color: #fde68a;
}
.pc-chip--supersed {
    background: var(--pc-supersed-bg);
    color: var(--pc-text-2);
    border-color: #cbd5e1;
}
.pc-chip--conflict {
    background: #fef2f2;
    color: #b91c1c;
    border-color: #fecaca;
}
.pc-chip--dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

/* KPI strip */
.pc-kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 18px;
}
.pc-kpi {
    background: #fff;
    border: 1px solid var(--pc-border);
    border-radius: 10px;
    padding: 14px 16px;
}
.pc-kpi--draft {
    background: linear-gradient(180deg, var(--pc-draft-bg) 0%, #fff 100%);
    border-color: #fde68a;
}
.pc-kpi-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    font-weight: 600;
}
.pc-kpi-val {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin-top: 4px;
}
.pc-kpi-sub {
    font-size: 11.5px;
    color: var(--pc-text-3);
    margin-top: 2px;
}

/* Grid */
.pc-grid {
    display: grid;
    grid-template-columns: 1.45fr 1fr;
    gap: 14px;
}
.pc-right-col {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.pc-card {
    background: #fff;
    border: 1px solid var(--pc-border);
    border-radius: 10px;
    overflow: hidden;
}
.pc-card-head {
    padding: 14px 18px;
    border-bottom: 1px solid var(--pc-border);
    display: flex;
    align-items: center;
    gap: 10px;
}
.pc-card-head--audit {
    border-bottom: 0;
    padding-bottom: 8px;
}
.pc-card-head-text {
    flex: 1;
    min-width: 0;
}
.pc-card-title {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
}
.pc-card-sub {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 2px;
}
.pc-pillrow {
    display: flex;
    gap: 4px;
}
.pc-pill {
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
}

/* Timeline */
.pc-vtimeline {
    padding: 16px 18px 6px;
}
.pc-vtl-track {
    display: flex;
    gap: 2px;
    height: 26px;
    border-radius: 6px;
    overflow: hidden;
    background: #f1f5f9;
}
.pc-vtl-seg {
    display: grid;
    place-items: center;
    font: 600 10.5px var(--pc-font-mono);
    letter-spacing: 0.06em;
}
.pc-vtl-supersed {
    background: #e2e8f0;
    color: var(--pc-text-2);
}
.pc-vtl-live {
    background: var(--pc-live);
    color: #fff;
}
.pc-vtl-draft {
    background: repeating-linear-gradient(45deg, #fcd34d, #fcd34d 4px, #fde68a 4px, #fde68a 8px);
    color: #78350f;
}
.pc-vtl-axis {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font: 500 10px var(--pc-font-mono);
    color: var(--pc-text-3);
}

/* Version row — flexible columns so the action buttons (Publish /
   Edit) aren't clipped on a narrow card. Actions =
   `auto` (content-width), the rest flexes. */
.pc-vrow {
    display: grid;
    grid-template-columns:
        92px
        minmax(112px, 1fr)
        minmax(82px, 0.8fr)
        56px
        minmax(90px, 1.3fr)
        auto;
    align-items: center;
    gap: 10px;
    padding: 11px 18px;
    border-top: 1px solid #f1f5f9;
}
.pc-vrow--head {
    background: #fbfbfd;
    padding: 8px 18px;
}
.pc-vrow--active {
    background: var(--pc-draft-bg);
}
.pc-vrow--active:hover {
    background: #fef3c7;
}
.pc-vrow:hover:not(.pc-vrow--head):not(.pc-vrow--active) {
    background: #fcfcfd;
}
.pc-vrow-headlabel {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--pc-text-3);
}
.pc-vrow-version {
    display: flex;
    align-items: center;
    gap: 8px;
}
.pc-vrow-vlabel {
    font: 700 14px var(--pc-font-mono);
    color: var(--pc-text);
}
.pc-vrow-cell {
    min-width: 0;
}
.pc-vrow-cell--right {
    text-align: right;
}
.pc-vrow-validity {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--pc-text);
}
.pc-vrow-arrow {
    color: var(--pc-text-3);
    margin: 0 4px;
}
.pc-vrow-inf {
    color: var(--pc-live);
    font-weight: 700;
}
.pc-vrow-sub {
    font-size: 10.5px;
    color: var(--pc-text-3);
    margin-top: 2px;
}
.pc-vrow-price {
    font-size: 13px;
    font-weight: 700;
    color: var(--pc-text);
}
.pc-vrow-price-unit {
    font-weight: 500;
    color: var(--pc-text-3);
    font-size: 11px;
}
.pc-vrow-impact {
    font-size: 13px;
    font-weight: 700;
    color: var(--pc-text);
}
.pc-vrow-impact--zero {
    color: #cbd5e1;
}
.pc-vrow-note {
    font-size: 12px;
    color: var(--pc-text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pc-vrow-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    flex-wrap: wrap;
}
.pc-vrow-actions .pc-btn {
    white-space: nowrap;
}

/* Diff */
.pc-diff-body {
    padding: 12px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.pc-diff-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border: 1px solid;
    border-radius: 7px;
}
.pc-diff-sign {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    color: #fff;
    font-weight: 800;
    font-size: 13px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
}
.pc-diff-main {
    flex: 1;
    min-width: 0;
}
.pc-diff-headline {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
}
.pc-diff-section {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
}
.pc-diff-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--pc-text);
}
.pc-diff-change {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 3px;
    font-size: 12px;
}
.pc-diff-from {
    text-decoration: line-through;
    color: var(--pc-text-3);
}
.pc-diff-to {
    color: var(--pc-text);
    font-weight: 600;
}
.pc-diff-arrow {
    display: inline-flex;
}
.pc-diff-tag {
    font-size: 10px;
}

/* Impact */
.pc-impact-strip {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 16px 18px;
    border-bottom: 1px solid #f1f5f9;
}
.pc-impact-num {
    font-size: 44px;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--pc-text);
    line-height: 1;
}
.pc-impact-bars {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.pc-impact-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 22px;
    position: relative;
}
.pc-impact-bar-fill {
    height: 8px;
    border-radius: 999px;
    min-width: 16px;
}
.pc-impact-bar-label {
    font-size: 11.5px;
    color: var(--pc-text-2);
}
.pc-impact-tenants {
    padding: 12px 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.pc-impact-tenant {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 9px;
    border-radius: 6px;
}
.pc-impact-tenant:hover {
    background: var(--pc-surface-2);
}
.pc-impact-avatar {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: #f1f5f9;
    color: var(--pc-text-2);
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    flex: 0 0 auto;
}
.pc-impact-body {
    flex: 1;
    min-width: 0;
}
.pc-impact-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--pc-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pc-impact-sub {
    font: 500 10.5px var(--pc-font-mono);
    color: var(--pc-text-3);
}

/* Audit */
.pc-audit-card {
    margin-top: 14px;
}
.pc-audit {
    padding: 4px 18px 16px;
}
.pc-audit-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 9px 0;
    border-top: 1px solid #f1f5f9;
}
.pc-audit-row:first-child {
    border-top: 0;
}
.pc-audit-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
}
.pc-audit-draft {
    background: #f59e0b;
}
.pc-audit-add {
    background: #10b981;
}
.pc-audit-change {
    background: #2563eb;
}
.pc-audit-publish {
    background: #8b5cf6;
}
.pc-audit-remove {
    background: #ef4444;
}
.pc-audit-when {
    font-size: 11.5px;
    color: #64748b;
    min-width: 130px;
}
.pc-audit-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--pc-text);
    color: #fff;
    display: grid;
    place-items: center;
    font: 700 11px var(--pc-font-sans);
    flex: 0 0 auto;
}
.pc-audit-who {
    font-size: 12px;
    color: var(--pc-text-2);
    min-width: 64px;
}
.pc-audit-what {
    font-size: 13px;
    color: var(--pc-text);
    flex: 1;
}

/* Empty */
.pc-empty {
    padding: 22px 18px;
    text-align: center;
    color: var(--pc-text-3);
    font-style: italic;
    font-size: 13px;
}
.pc-empty--inline {
    padding: 12px;
}

@media (max-width: 1100px) {
    .pc-grid {
        grid-template-columns: 1fr;
    }
    .pc-kpis {
        grid-template-columns: repeat(2, 1fr);
    }
    .pc-vrow {
        grid-template-columns: 88px 1fr 1fr 52px minmax(80px, 1.2fr);
        gap: 8px;
    }
    .pc-vrow-actions {
        grid-column: 1 / -1;
        justify-content: flex-start;
    }
}
</style>

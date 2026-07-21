<template>
    <div class="pd">
        <PlanDetailHeader
            :plan="plan"
            :draft-version="draftVersion"
            :tenant-total="tenantTotal"
            :published-count="publishedCount"
            @back="$emit('back')"
            @delete-plan="$emit('deletePlan')"
            @clone-plan="$emit('clonePlan')"
            @create-draft="$emit('createDraft')"
            @publish="$emit('publish', $event)"
            @update-plan="$emit('updatePlan', $event)"
        />

        <PlanDetailKpis
            :live-version="liveVersion"
            :draft-version="draftVersion"
            :tenant-total="tenantTotal"
            :version-count="versions.length"
            :published-count="publishedCount"
        />

        <div class="pd-body">
            <PlanVersionsPanel
                v-model:selected-id="selectedId"
                :chronological="chronological"
                :table-rows="tableRows"
                :draft-version="draftVersion"
                :next-draft-version="nextDraftVersion"
                :timeline-ticks="timelineTicks"
                :impact-by-version="impactByVersion"
                :status-of="statusOf"
                :status-chip="statusChip"
                :editability-of="editabilityOf"
                :format-money="formatMoney"
                :format-date="formatDate"
                @create-draft="$emit('createDraft')"
                @publish="$emit('publish', $event)"
                @edit-draft="$emit('editDraft', $event)"
                @open-terminate="openTerminateDialog"
            />

            <PlanVersionDiffPanel
                :selected-version="selectedVersion"
                :predecessor="predecessor"
                :diff="diff"
                :diff-rows="diffRows"
                :quota-change-count="quotaChangeCount"
                :status-of="statusOf"
                :quota-count="quotaCount"
                :quotas-of="quotasOf"
                :feature-label="featureLabel"
                :quota-label="quotaLabel"
                :quota-unit="quotaUnit"
                :bundle-label="bundleLabel"
            />
        </div>

        <PlanTerminateDialog
            v-model="terminateOpen"
            v-model:date-input="terminateDateInput"
            :plan="plan"
            :target="terminateTarget"
            :error="terminateError"
            :terminating="terminating"
            @execute="executeTerminate"
        />

        <PlanAuditLog
            v-if="auditRows.length > 0 || loadingAudit"
            :audit-rows="auditRows"
            :loading-audit="loadingAudit"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    isVersionEditable,
    type PlanRow,
    type PlanVersionRow,
} from '@saasicat/types';
import PlanAuditLog from './PlanAuditLog.vue';
import PlanDetailHeader from './PlanDetailHeader.vue';
import PlanDetailKpis from './PlanDetailKpis.vue';
import PlanTerminateDialog from './PlanTerminateDialog.vue';
import PlanVersionDiffPanel from './PlanVersionDiffPanel.vue';
import PlanVersionsPanel from './PlanVersionsPanel.vue';
import type {
    AuditRow,
    BundleEntry,
    DiffRow,
    DiscoveryQuota,
    FeatureMeta,
    PlanVersionDiff,
    PlanVersionEditability,
    PlanVersionStatus,
} from './types.js';

// PlanDetail — drill-in for a single plan, 1:1 from the plan simulation
// (plan-detail.jsx): editable title, KPI cards, version timeline,
// clickable version table, diff/contents panel per selected version,
// plus audit log. Replaces the former cockpit as the drill-in.

const props = withDefaults(
    defineProps<{
        plan: PlanRow;
        versions: PlanVersionRow[];
        impactByVersion?: Record<number, number>;
        auditRows?: AuditRow[];
        loadingAudit?: boolean;
        availableQuotas?: DiscoveryQuota[];
        availableBundles?: BundleEntry[];
        featureRegistry?: Record<string, FeatureMeta>;
        /**
         * Optional callback for `POST /admin/catalog/plan-versions/:id/terminate`.
         * The platform component delegates the HTTP wiring to the consumer
         * (PlansPage.vue) — see `endsAt` on PlanVersionRow.
         */
        submitTerminate?: (versionId: string, endsAt: string) => Promise<void>;
    }>(),
    {
        impactByVersion: () => ({}),
        auditRows: () => [],
        loadingAudit: false,
        availableQuotas: () => [],
        availableBundles: () => [],
        featureRegistry: () => ({}),
        submitTerminate: undefined,
    },
);

const emit = defineEmits<{
    (e: 'back'): void;
    (e: 'createDraft'): void;
    (e: 'editDraft', version: PlanVersionRow): void;
    (e: 'publish', version: PlanVersionRow): void;
    (e: 'clonePlan'): void;
    (e: 'deletePlan'): void;
    (e: 'updatePlan', patch: { label: string }): void;
    (e: 'terminate', versionId: string, endsAt: string): void;
}>();

// ── Status / Selection ──────────────────────────────────────────────
function statusOf(v: PlanVersionRow): PlanVersionStatus {
    if (v.publishedAt === null) return 'draft';
    if (v.supersededAt !== null) return 'superseded';
    return 'live';
}

/**
 * Editability decision per version — identical to the backend rule
 * (`isVersionEditable`). The UI uses the result both for the visibility
 * of the edit button and for the badge on published-but-future versions
 * (SPEC_V2 §11.1 M6 Pack 2c).
 */
function editabilityOf(v: PlanVersionRow): PlanVersionEditability {
    return isVersionEditable(v);
}
function statusChip(v: PlanVersionRow): string {
    const s = statusOf(v);
    return s === 'live' ? 'live' : s === 'draft' ? 'draft' : 'supersed';
}

const chronological = computed(() => [...props.versions].sort((a, b) => a.version - b.version));
const tableRows = computed(() => [...props.versions].sort((a, b) => b.version - a.version));

const liveVersion = computed(
    () => props.versions.find((v) => v.publishedAt !== null && v.supersededAt === null) ?? null,
);
const draftVersion = computed(() => props.versions.find((v) => v.publishedAt === null) ?? null);
const publishedCount = computed(() => props.versions.filter((v) => v.publishedAt !== null).length);
const nextDraftVersion = computed(
    () => props.versions.reduce((m, v) => Math.max(m, v.version), 0) + 1,
);
const tenantTotal = computed(() => Object.values(props.impactByVersion).reduce((s, n) => s + n, 0));

const newest = computed(() => chronological.value[chronological.value.length - 1] ?? null);
const selectedId = ref<string | null>(newest.value?.id ?? null);
watch(newest, (n) => {
    if (!selectedId.value || !props.versions.some((v) => v.id === selectedId.value)) {
        selectedId.value = n?.id ?? null;
    }
});

const selectedVersion = computed(
    () => props.versions.find((v) => v.id === selectedId.value) ?? newest.value,
);
const predecessor = computed<PlanVersionRow | null>(() => {
    const sel = selectedVersion.value;
    if (!sel) return null;
    const earlier = chronological.value.filter((v) => v.version < sel.version);
    return earlier.length > 0 ? earlier[earlier.length - 1] : null;
});

// ── Timeline ticks ──────────────────────────────────────────────────
const timelineTicks = computed(() => {
    const ticks: string[] = [];
    for (const v of chronological.value) {
        if (v.validFrom) ticks.push(v.validFrom.slice(0, 7));
    }
    ticks.push('jetzt');
    return ticks;
});

// ── Money / Quotas ──────────────────────────────────────────────────
function formatMoney(raw: string | number): string {
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return String(raw);
    if (num === 0) return '0 €';
    if (Number.isInteger(num)) return `${num} €`;
    return `${num.toFixed(2).replace('.', ',')} €`;
}
function quotasOf(v: PlanVersionRow): Record<string, number> {
    if (v.quotas && Object.keys(v.quotas).length > 0) return v.quotas;
    const legacy: Record<string, number> = {};
    if (typeof v.maxUsers === 'number') legacy.users = v.maxUsers;
    if (typeof v.maxVehicles === 'number') legacy.vehicles = v.maxVehicles;
    if (typeof v.maxStorageGb === 'number') legacy.storageGb = v.maxStorageGb;
    return legacy;
}
function quotaCount(v: PlanVersionRow): number {
    return Object.keys(quotasOf(v)).length;
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
function bundleLabel(key: string): string {
    return props.availableBundles.find((b) => b.bundleKey === key)?.label || key;
}

// ── Diff selected vs. predecessor ───────────────────────────────────
const diff = computed<PlanVersionDiff>(() => {
    const to = selectedVersion.value;
    const from = predecessor.value;
    if (!to || !from) {
        return {
            featuresAdded: [] as string[],
            featuresRemoved: [] as string[],
            quotasAdded: [] as Array<{ key: string; value: number }>,
            quotasRemoved: [] as Array<{ key: string; value: number }>,
            quotasChanged: [] as Array<{ key: string; from: number; to: number }>,
            priceChanged: false,
        };
    }
    const featuresAdded = to.features.filter((f) => !from.features.includes(f));
    const featuresRemoved = from.features.filter((f) => !to.features.includes(f));
    const fromQ = quotasOf(from);
    const toQ = quotasOf(to);
    const quotasAdded: Array<{ key: string; value: number }> = [];
    const quotasRemoved: Array<{ key: string; value: number }> = [];
    const quotasChanged: Array<{ key: string; from: number; to: number }> = [];
    for (const k of new Set([...Object.keys(fromQ), ...Object.keys(toQ)])) {
        const fv = fromQ[k];
        const tv = toQ[k];
        if (fv === undefined && tv !== undefined) quotasAdded.push({ key: k, value: tv });
        else if (fv !== undefined && tv === undefined) quotasRemoved.push({ key: k, value: fv });
        else if (fv !== undefined && tv !== undefined && fv !== tv)
            quotasChanged.push({ key: k, from: fv, to: tv });
    }
    return {
        featuresAdded,
        featuresRemoved,
        quotasAdded,
        quotasRemoved,
        quotasChanged,
        priceChanged: from.monthlyNet !== to.monthlyNet || from.yearlyNet !== to.yearlyNet,
    };
});

const quotaChangeCount = computed(
    () =>
        diff.value.quotasAdded.length +
        diff.value.quotasRemoved.length +
        diff.value.quotasChanged.length,
);

const diffRows = computed<DiffRow[]>(() => {
    const out: DiffRow[] = [];
    for (const f of diff.value.featuresAdded)
        out.push({
            id: 'af-' + f,
            kind: 'add',
            sign: '+',
            tag: 'neu',
            label: featureLabel(f),
            key: f,
        });
    for (const f of diff.value.featuresRemoved)
        out.push({
            id: 'rf-' + f,
            kind: 'rm',
            sign: '−',
            tag: 'entfernt',
            label: featureLabel(f),
            key: f,
        });
    for (const q of diff.value.quotasChanged) {
        const u = quotaUnit(q.key);
        out.push({
            id: 'cq-' + q.key,
            kind: 'mod',
            sign: '~',
            tag: 'geändert',
            label: quotaLabel(q.key),
            key: q.key,
            from: `${q.from} ${u}`.trim(),
            to: `${q.to} ${u}`.trim(),
        });
    }
    for (const q of diff.value.quotasAdded) {
        const u = quotaUnit(q.key);
        out.push({
            id: 'aq-' + q.key,
            kind: 'add',
            sign: '+',
            tag: 'neu',
            label: quotaLabel(q.key),
            key: q.key,
            from: '—',
            to: `${q.value} ${u}`.trim(),
        });
    }
    for (const q of diff.value.quotasRemoved) {
        const u = quotaUnit(q.key);
        out.push({
            id: 'rq-' + q.key,
            kind: 'rm',
            sign: '−',
            tag: 'entfernt',
            label: quotaLabel(q.key),
            key: q.key,
            from: `${q.value} ${u}`.trim(),
            to: '—',
        });
    }
    if (diff.value.priceChanged && selectedVersion.value && predecessor.value) {
        out.push({
            id: 'price',
            kind: 'mod',
            sign: '~',
            tag: 'geändert',
            label: 'Preis (Monat / Jahr)',
            key: 'pricing',
            from: `${formatMoney(predecessor.value.monthlyNet)} / ${formatMoney(predecessor.value.yearlyNet)}`,
            to: `${formatMoney(selectedVersion.value.monthlyNet)} / ${formatMoney(selectedVersion.value.yearlyNet)}`,
        });
    }
    return out;
});

// ── Terminate dialog ────────────────────────────────────────────────
const terminateOpen = ref(false);
const terminateTarget = ref<PlanVersionRow | null>(null);
const terminateDateInput = ref<string>('');
const terminating = ref(false);
const terminateError = ref<string | null>(null);

function openTerminateDialog(v: PlanVersionRow): void {
    terminateTarget.value = v;
    terminateDateInput.value = v.endsAt ? v.endsAt.slice(0, 10) : '';
    terminateError.value = null;
    terminateOpen.value = true;
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

async function executeTerminate(): Promise<void> {
    if (!terminateTarget.value || !terminateDateInput.value) return;
    const dateStr = terminateDateInput.value;
    // Set to end of day: YYYY-MM-DD becomes an ISO timestamp at the end of the day.
    const endsAtIso = new Date(`${dateStr}T23:59:59.000Z`).toISOString();
    terminating.value = true;
    terminateError.value = null;
    try {
        if (props.submitTerminate) {
            await props.submitTerminate(terminateTarget.value.id, endsAtIso);
        } else {
            emit('terminate', terminateTarget.value.id, endsAtIso);
        }
        terminateOpen.value = false;
        terminateTarget.value = null;
    } catch (err: unknown) {
        const e = err as { status?: number; body?: { code?: string; message?: string } };
        const code = e?.body?.code;
        if (code === 'PLAN_TERMINATE_DATE_NOT_FUTURE') {
            terminateError.value = 'Das Datum muss in der Zukunft liegen.';
        } else if (code === 'PLAN_VERSION_NOT_LIVE') {
            terminateError.value =
                'Diese Version ist nicht live (draft oder superseded) und kann nicht terminiert werden.';
        } else if (code === 'PLAN_TERMINATE_NOT_IMPLEMENTED') {
            terminateError.value =
                'Backend unterstützt Terminate noch nicht — bitte API-Server neu bauen.';
        } else if (e?.body?.message) {
            terminateError.value = e.body.message;
        } else {
            terminateError.value = err instanceof Error ? err.message : 'Terminate fehlgeschlagen.';
        }
    } finally {
        terminating.value = false;
    }
}
</script>

<style>
.pd {
    --primary: #2563eb;
    --border: #e5e7eb;
    --border-strong: #d1d5db;
    --text: #0f172a;
    --text-2: #475569;
    --bg: #f6f7f9;
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;

    padding: 22px 26px;
    background: var(--bg);
    font-family: var(--font-sans);
    color: var(--text);
    min-height: 100%;
    box-sizing: border-box;
}
.pd * {
    box-sizing: border-box;
}
/* Consumer apps load Quasar, which styles h1–h6 globally with very large
   line-heights. Neutralize that here so headings (and the tier chip
   sitting next to them) are aligned correctly. */
.pd h1,
.pd h2,
.pd h3,
.pd h4 {
    line-height: 1.2;
    margin: 0;
}
.pd-code {
    font: 500 11px var(--font-mono);
}

/* buttons + chips (1:1 styles.css) */
.btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    border-radius: 7px;
    font: 500 13px var(--font-sans);
    cursor: pointer;
    border: 1px solid var(--border-strong);
    background: #fff;
    color: var(--text);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.btn:hover {
    background: #f8fafc;
}
.btn.primary {
    background: var(--primary);
    border-color: var(--primary);
    color: #fff;
}
.btn.primary:hover {
    background: #1d4ed8;
}
.btn.btn--sm {
    padding: 5px 9px;
    font-size: 12px;
    gap: 5px;
}
.btn.danger {
    border-color: #fecaca;
    color: #b91c1c;
    background: #fff;
}
.btn.danger:hover {
    background: #fef2f2;
    border-color: #fca5a5;
}
.chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    background: #f8fafc;
    color: var(--text-2);
    border: 1px solid var(--border);
}
.chip.live {
    background: #ecfdf5;
    color: #047857;
    border-color: #a7f3d0;
}
.chip.draft {
    background: #fffbeb;
    color: #b45309;
    border-color: #fde68a;
}
.chip.supersed {
    background: #f1f5f9;
    color: #475569;
    border-color: #cbd5e1;
}
.chip.dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

/* header */
.pd-header {
    display: flex;
    align-items: flex-start;
    gap: 18px;
    margin-bottom: 18px;
}
.pd-header-left {
    display: flex;
    align-items: flex-start;
    gap: 14px;
    min-width: 0;
    flex: 1;
}
.pd-header-titles {
    min-width: 0;
}
.pd-back-arrow {
    display: inline-flex;
    transform: rotate(180deg);
}
.pd-tier-chip {
    font: 700 10.5px var(--font-mono);
    letter-spacing: 0.08em;
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #e2e8f0;
    padding: 4px 10px;
    border-radius: 6px;
    margin-top: 8px;
}
.pd-title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.025em;
    margin: 0;
    color: var(--text);
}
.pd-desc {
    margin-top: 4px;
    font-size: 13px;
    color: var(--text-2);
}
.pd-actions {
    display: flex;
    gap: 8px;
    align-items: center;
}
.pd-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
}
.pd-title-edit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    color: #94a3b8;
    cursor: pointer;
    transition:
        background 0.12s,
        color 0.12s,
        border-color 0.12s;
}
.pd-title-edit-btn:hover {
    background: #f1f5f9;
    color: var(--primary);
    border-color: #e2e8f0;
}
.pd-title-input {
    font: inherit;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.025em;
    color: var(--text);
    border: 0;
    background: #fffbeb;
    outline: 2px solid #fcd34d;
    padding: 2px 8px;
    border-radius: 6px;
    min-width: 220px;
}
.pd-title-hint {
    font-size: 11px;
    color: #92400e;
    font-weight: 500;
    background: #fffbeb;
    border: 1px solid #fde68a;
    padding: 2px 8px;
    border-radius: 999px;
    margin-left: 4px;
}

/* KPI cards */
.pd-kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 16px;
}
.pd-kpi {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px 16px 12px;
    min-height: 102px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.pd-kpi-label {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
}
.pd-kpi-big {
    font: 700 26px/1 var(--font-sans);
    letter-spacing: -0.025em;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 10px;
}
.pd-kpi-sub {
    font-size: 11.5px;
    color: #64748b;
    margin-top: auto;
}
.pd-kpi.draft {
    background: linear-gradient(180deg, #fffbeb 0%, #fffef7 100%);
    border-color: #fde68a;
}
.pd-kpi.draft .pd-kpi-label,
.pd-kpi.draft .pd-kpi-sub {
    color: #92400e;
}

/* body */
.pd-body {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
}
.pd-panel {
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
}
.pd-panel-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid #f1f5f9;
}
.pd-panel-title {
    font-size: 15px;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.01em;
    color: var(--text);
}
.pd-panel-sub {
    font-size: 11.5px;
    color: #64748b;
    margin-top: 3px;
}
.pd-panel-head-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
}

/* timeline */
.pd-timeline {
    padding: 14px 16px 6px;
}
.pd-timeline-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #94a3b8;
    margin-bottom: 8px;
    font-weight: 500;
}
.pd-timeline-hint svg {
    color: #cbd5e1;
    width: 12px;
    height: 12px;
}
.pd-timeline-bar {
    display: flex;
    height: 24px;
    border-radius: 6px;
    overflow: hidden;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
}
.pd-timeline-seg {
    display: flex;
    align-items: center;
    justify-content: center;
    font: 600 11px var(--font-sans);
    color: rgba(15, 23, 42, 0.65);
    border-right: 1px solid rgba(0, 0, 0, 0.06);
    white-space: nowrap;
    padding: 0 8px;
    min-width: 0;
    cursor: pointer;
    transition:
        filter 0.12s,
        transform 0.12s,
        box-shadow 0.15s;
}
.pd-timeline-seg:last-child {
    border-right: 0;
}
.pd-timeline-seg:hover {
    filter: brightness(0.92);
    transform: translateY(-1px);
}
.pd-timeline-seg:active {
    transform: translateY(0);
}
.pd-timeline-seg.superseded {
    background: #e2e8f0;
    color: #475569;
}
.pd-timeline-seg.live {
    background: #10b981;
    color: #fff;
    font-weight: 700;
}
.pd-timeline-seg.draft {
    background: repeating-linear-gradient(135deg, #fde68a 0 8px, #fcd34d 8px 16px);
    color: #78350f;
    font-weight: 700;
}
.pd-timeline-seg.is-selected {
    position: relative;
    z-index: 1;
    outline: 2px solid var(--primary);
    outline-offset: -2px;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
    font-weight: 700;
}
.pd-timeline-seg.is-selected.superseded {
    color: #0f172a;
}
.pd-timeline-seg.is-selected.live {
    outline-color: #047857;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.25);
}
.pd-timeline-seg.is-selected.draft {
    outline-color: #b45309;
    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.3);
}
.pd-timeline-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font: 500 10.5px var(--font-mono);
    color: #94a3b8;
}

/* versions table */
.pd-versions-tbl {
    display: grid;
    /* minmax(0, …) instead of a bare fr: otherwise the content columns do
       not shrink below their min-content width (long change notes) → the grid
       overflows and the card's overflow:hidden clips it on the right.
       Action column with a fixed minimum width (96px): a bare `auto`
       track collapses to pure padding width in the consumer context, and then
       the draft buttons are cut off. */
    grid-template-columns:
        64px minmax(0, 1.4fr) minmax(0, 1.1fr) minmax(0, 0.8fr) minmax(0, 1fr)
        minmax(96px, auto);
    align-items: stretch;
    border-top: 1px solid #f1f5f9;
    margin-top: 12px;
}
.pd-versions-head {
    display: contents;
}
.pd-versions-head > div {
    background: #fbfbfd;
    padding: 9px 12px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
    font-weight: 700;
    border-bottom: 1px solid var(--border);
}
.pd-vrow {
    display: contents;
    cursor: pointer;
}
.pd-vrow > div {
    padding: 13px 12px;
    border-bottom: 1px solid #f1f5f9;
    display: flex;
    align-items: center;
    font-size: 12.5px;
    color: var(--text);
}
.pd-vrow:hover > div {
    background: #fafbfd;
}
.pd-vrow.is-draft > div {
    background: #fffdf5;
}
.pd-vrow.is-draft:hover > div {
    background: #fff8e7;
}
.pd-vrow.is-selected > div {
    background: #eff6ff !important;
    box-shadow: inset 0 -1px 0 0 #bfdbfe;
}
.pd-vrow.is-selected.is-draft > div {
    background: #fff4d6 !important;
    box-shadow: inset 0 -1px 0 0 #fcd34d;
}
.pd-vrow.is-selected > div:first-child {
    box-shadow:
        inset 3px 0 0 0 var(--primary),
        inset 0 -1px 0 0 #bfdbfe;
}
.pd-vrow.is-draft > div:first-child {
    box-shadow: inset 3px 0 0 0 #f59e0b;
}
.pd-vrow.is-selected.is-draft > div:first-child {
    box-shadow:
        inset 3px 0 0 0 #f59e0b,
        inset 0 -1px 0 0 #fcd34d;
}
.pd-vcol {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
}
.pd-v-num {
    font: 700 14px var(--font-sans);
}
.pd-validity {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.pd-validity-line {
    display: flex;
    align-items: center;
    gap: 6px;
}
.pd-validity-sub {
    font-size: 10.5px;
    color: #94a3b8;
}
.pd-validity-date {
    font: 500 12.5px var(--font-mono);
}
.pd-arrow-inf {
    font: 600 13px var(--font-mono);
    color: #94a3b8;
}
.pd-pricing-m {
    font: 600 13px var(--font-sans);
}
.pd-pricing-y {
    font: 500 10.5px var(--font-sans);
    color: #94a3b8;
    margin-top: 2px;
}
.pd-impact-num {
    font: 700 14px var(--font-sans);
}
.pd-impact-sub {
    font-size: 10.5px;
    color: #94a3b8;
}
.pd-change-note {
    color: #94a3b8;
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.pd-row-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
    align-items: center;
}
.pd-endsat-badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: 999px;
    font: 600 10.5px var(--font-mono);
    background: #fffbeb;
    color: #b45309;
    border: 1px solid #fde68a;
    white-space: nowrap;
}

/* diff */
.pd-diff-chips {
    display: flex;
    gap: 6px;
}
.pd-diff-chip {
    font: 700 11px var(--font-mono);
    padding: 3px 8px;
    border-radius: 6px;
}
.pd-diff-chip.add {
    background: #ecfdf5;
    color: #047857;
    border: 1px solid #a7f3d0;
}
.pd-diff-chip.rm {
    background: #fef2f2;
    color: #b91c1c;
    border: 1px solid #fecaca;
}
.pd-diff-chip.mod {
    background: #f1f5f9;
    color: #475569;
    border: 1px solid #e2e8f0;
}
.pd-diff-list {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.pd-diff-row {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 11px 12px 11px 0;
    overflow: hidden;
}
.pd-diff-row.add {
    background: linear-gradient(90deg, #ecfdf5 0%, #fff 60%);
    border-color: #a7f3d0;
}
.pd-diff-row.rm {
    background: linear-gradient(90deg, #fef2f2 0%, #fff 60%);
    border-color: #fecaca;
}
.pd-diff-row.mod {
    background: linear-gradient(90deg, #f8fafc 0%, #fff 60%);
    border-color: #e2e8f0;
}
.pd-diff-icon {
    width: 32px;
    align-self: stretch;
    display: grid;
    place-items: center;
    flex: 0 0 32px;
    color: #fff;
    font: 700 16px var(--font-sans);
}
.pd-diff-row.add .pd-diff-icon {
    background: #10b981;
}
.pd-diff-row.rm .pd-diff-icon {
    background: #ef4444;
}
.pd-diff-row.mod .pd-diff-icon {
    background: #64748b;
}
.pd-diff-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.pd-diff-kind {
    font: 700 10px var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #64748b;
}
.pd-diff-label {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--text);
}
.pd-diff-key {
    font: 500 11px var(--font-mono);
    color: #94a3b8;
}
.pd-diff-vals {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 500 12px var(--font-mono);
}
.pd-diff-strike {
    text-decoration: line-through;
    color: #94a3b8;
}
.pd-diff-arrow {
    color: #cbd5e1;
}
.pd-diff-new {
    color: #047857;
    font-weight: 600;
}
.pd-diff-tag {
    margin-left: auto;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 9px;
    border-radius: 999px;
    border: 1px solid;
}
.pd-diff-tag.add {
    background: #fff;
    color: #047857;
    border-color: #a7f3d0;
}
.pd-diff-tag.rm {
    background: #fff;
    color: #b91c1c;
    border-color: #fecaca;
}
.pd-diff-tag.mod {
    background: #fff;
    color: #475569;
    border-color: #cbd5e1;
}
.pd-diff-row.plain {
    background: #fff;
    border-color: #e2e8f0;
    padding: 11px 12px 11px 0;
}
.pd-diff-section {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    padding: 0 2px;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #94a3b8;
    font-weight: 700;
}
.pd-diff-section:first-child {
    margin-top: 0;
}
.pd-diff-section hr {
    flex: 1;
    border: 0;
    border-top: 1px dashed #e2e8f0;
}
.pd-diff-empty {
    padding: 28px 18px;
    text-align: center;
    color: #94a3b8;
    font-size: 13px;
}
.pd-diff-empty b {
    display: block;
    color: #475569;
    font-size: 14px;
    margin-bottom: 4px;
}

/* audit */
.pd-audit {
    margin-top: 16px;
}
.pd-audit-body {
    padding: 4px 16px 14px;
}
.pd-audit-row {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 9px 0;
    border-top: 1px solid #f1f5f9;
}
.pd-audit-row:first-child {
    border-top: 0;
}
.pd-audit-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
}
.pd-audit-draft {
    background: #f59e0b;
}
.pd-audit-add {
    background: #10b981;
}
.pd-audit-change {
    background: #2563eb;
}
.pd-audit-publish {
    background: #8b5cf6;
}
.pd-audit-remove {
    background: #ef4444;
}
.pd-audit-when {
    font-size: 11.5px;
    color: #64748b;
    min-width: 130px;
}
.pd-audit-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--text);
    color: #fff;
    display: grid;
    place-items: center;
    font: 700 11px var(--font-sans);
    flex: 0 0 auto;
}
.pd-audit-who {
    font-size: 12px;
    color: var(--text-2);
    min-width: 64px;
}
.pd-audit-what {
    font-size: 13px;
    color: var(--text);
    flex: 1;
}

@media (max-width: 1180px) {
    .pd-body {
        grid-template-columns: 1fr;
    }
    .pd-kpis {
        grid-template-columns: repeat(2, 1fr);
    }
}
</style>

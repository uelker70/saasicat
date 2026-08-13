<template>
    <div>
        <AdminSection class="q-mb-md">
            <PlanDetailKpis
                :live-version="liveVersion"
                :draft-version="draftVersion"
                :tenant-total="tenantTotal"
                :version-count="versions.length"
                :published-count="publishedCount"
            />
        </AdminSection>

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
import { isVersionEditable, type PlanRow, type PlanVersionRow } from '@saasicat/types';
import { formatCurrency } from '../../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import PlanAuditLog from './PlanAuditLog.vue';
import AdminSection from '../admin-page/AdminSection.vue';
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
    (e: 'createDraft'): void;
    (e: 'editDraft', version: PlanVersionRow): void;
    (e: 'publish', version: PlanVersionRow): void;
    (e: 'terminate', versionId: string, endsAt: string): void;
}>();

const msg = useSaMessages('planDetail');
const { locale, intlLocale } = useSuperAdminI18n();

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
    ticks.push(msg.value.versions.timelineNow);
    return ticks;
});

// ── Money / Quotas ──────────────────────────────────────────────────
function formatMoney(raw: string | number): string {
    const num = typeof raw === 'string' ? Number(raw) : raw;
    if (!Number.isFinite(num)) return String(raw);
    return formatCurrency(num, locale.value);
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
            tag: msg.value.diff.tagNew,
            label: featureLabel(f),
            key: f,
        });
    for (const f of diff.value.featuresRemoved)
        out.push({
            id: 'rf-' + f,
            kind: 'rm',
            sign: '−',
            tag: msg.value.diff.tagRemoved,
            label: featureLabel(f),
            key: f,
        });
    for (const q of diff.value.quotasChanged) {
        const u = quotaUnit(q.key);
        out.push({
            id: 'cq-' + q.key,
            kind: 'mod',
            sign: '~',
            tag: msg.value.diff.tagChanged,
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
            tag: msg.value.diff.tagNew,
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
            tag: msg.value.diff.tagRemoved,
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
            tag: msg.value.diff.tagChanged,
            label: msg.value.diff.priceLabel,
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
    return d.toLocaleDateString(intlLocale.value, {
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
            terminateError.value = msg.value.terminateDialog.errorDateNotFuture;
        } else if (code === 'PLAN_VERSION_NOT_PUBLISHED' || code === 'PLAN_VERSION_SUPERSEDED') {
            // Split out of the former PLAN_VERSION_NOT_LIVE; both mean the
            // version cannot be terminated, so they share one message.
            terminateError.value = msg.value.terminateDialog.errorVersionNotLive;
        } else if (code === 'PLAN_TERMINATE_NOT_IMPLEMENTED') {
            terminateError.value = msg.value.terminateDialog.errorNotImplemented;
        } else if (e?.body?.message) {
            terminateError.value = e.body.message;
        } else {
            terminateError.value =
                err instanceof Error ? err.message : msg.value.terminateDialog.errorFailed;
        }
    } finally {
        terminating.value = false;
    }
}
</script>

<style>
.pd-code {
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
}

/* buttons + chips (1:1 styles.css) */
.btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px;
    border-radius: 7px;
    font: 500 var(--sa-text-md) var(--sa-font-body);
    cursor: pointer;
    border: 1px solid var(--sa-color-border-strong);
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-fg-heading);
    transition:
        background 0.12s,
        border-color 0.12s;
}
.btn:hover {
    background: var(--sa-color-bg-sunken);
}
.btn.primary {
    background: var(--sa-color-accent);
    border-color: var(--sa-color-accent);
    color: var(--sa-color-fg-on-accent);
}
.btn.primary:hover {
    background: var(--sa-color-accent-strong);
}
.btn.btn--sm {
    padding: 5px 9px;
    font-size: var(--sa-text-sm);
    gap: 5px;
}
.chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--sa-text-xs);
    font-weight: 600;
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-secondary);
    border: 1px solid var(--sa-color-border);
}
.chip.live {
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive-fg);
    border-color: var(--sa-color-positive-border);
}
.chip.draft {
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    border-color: var(--sa-color-warning-border);
}
.chip.supersed {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    border-color: var(--sa-color-border-strong);
}
.chip.dot::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
}

/* header */

/* KPI cards */

/* body */
.pd-body {
    display: grid;
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
    gap: 16px;
    align-items: start;
}
/* Surface, border and radius come from `.sa-section` — the panel IS one.
 * Only `overflow` stays, so content is clipped at the rounded edge. */
.pd-panel {
    overflow: hidden;
}
.pd-panel-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--sa-color-border-soft);
}
.pd-panel-title {
    font-size: var(--sa-text-lg);
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.01em;
    color: var(--sa-color-fg-heading);
}
.pd-panel-sub {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
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
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    margin-bottom: 8px;
    font-weight: 500;
}
.pd-timeline-hint svg {
    color: var(--sa-color-fg-disabled);
    width: 12px;
    height: 12px;
}
.pd-timeline-bar {
    display: flex;
    height: 24px;
    border-radius: 6px;
    overflow: hidden;
    background: var(--sa-color-border-soft);
    border: 1px solid var(--sa-color-border);
}
.pd-timeline-seg {
    display: flex;
    align-items: center;
    justify-content: center;
    font: 600 var(--sa-text-xs) var(--sa-font-body);
    color: var(--sa-color-fg-secondary);
    border-right: 1px solid var(--sa-color-border-soft);
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
    background: var(--sa-color-border);
    color: var(--sa-color-fg-secondary);
}
.pd-timeline-seg.live {
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
    font-weight: 700;
}
.pd-timeline-seg.draft {
    background: repeating-linear-gradient(
        135deg,
        var(--sa-color-warning-border) 0 8px,
        var(--sa-color-warning-strong) 8px 16px
    );
    color: var(--sa-color-warning-fg);
    font-weight: 700;
}
.pd-timeline-seg.is-selected {
    position: relative;
    z-index: 1;
    outline: 2px solid var(--sa-color-accent);
    outline-offset: -2px;
    box-shadow: 0 0 0 3px var(--sa-shadow-tint-3);
    font-weight: 700;
}
.pd-timeline-seg.is-selected.superseded {
    color: var(--sa-color-fg-heading);
}
.pd-timeline-seg.is-selected.live {
    outline-color: var(--sa-color-positive);
    box-shadow: 0 0 0 3px var(--sa-shadow-tint-4);
}
.pd-timeline-seg.is-selected.draft {
    outline-color: var(--sa-color-warning-fg);
    box-shadow: 0 0 0 3px var(--sa-shadow-tint-4);
}
.pd-timeline-ticks {
    display: flex;
    justify-content: space-between;
    margin-top: 6px;
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
    color: var(--sa-color-fg-subtle);
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
    border-top: 1px solid var(--sa-color-border-soft);
    margin-top: 12px;
}
.pd-versions-head {
    display: contents;
}
.pd-versions-head > div {
    background: var(--sa-color-bg-surface-raised);
    padding: 9px 12px;
    font-size: var(--sa-text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--sa-color-fg-muted);
    font-weight: 700;
    border-bottom: 1px solid var(--sa-color-border);
}
.pd-vrow {
    display: contents;
    cursor: pointer;
}
.pd-vrow > div {
    padding: 13px 12px;
    border-bottom: 1px solid var(--sa-color-border-soft);
    display: flex;
    align-items: center;
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
}
.pd-vrow:hover > div {
    background: var(--sa-color-bg-surface-raised);
}
.pd-vrow.is-draft > div {
    background: var(--sa-color-warning-surface);
}
.pd-vrow.is-draft:hover > div {
    background: var(--sa-color-warning-surface);
}
.pd-vrow.is-selected > div {
    background: var(--sa-color-accent-surface-strong) !important;
    box-shadow: inset 0 -1px 0 0 var(--sa-color-info-border);
}
.pd-vrow.is-selected.is-draft > div {
    background: var(--sa-color-warning-surface-strong) !important;
    box-shadow: inset 0 -1px 0 0 var(--sa-color-warning-border);
}
.pd-vrow.is-selected > div:first-child {
    box-shadow:
        inset 3px 0 0 0 var(--sa-color-accent),
        inset 0 -1px 0 0 var(--sa-color-info-border);
}
.pd-vrow.is-draft > div:first-child {
    box-shadow: inset 3px 0 0 0 var(--sa-color-warning-strong);
}
.pd-vrow.is-selected.is-draft > div:first-child {
    box-shadow:
        inset 3px 0 0 0 var(--sa-color-warning-strong),
        inset 0 -1px 0 0 var(--sa-color-warning-border);
}
.pd-vcol {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: flex-start;
}
.pd-v-num {
    font: 700 var(--sa-text-lg) var(--sa-font-body);
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
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.pd-validity-date {
    font: 500 var(--sa-text-md) var(--sa-font-mono);
}
.pd-arrow-inf {
    font: 600 var(--sa-text-md) var(--sa-font-mono);
    color: var(--sa-color-fg-subtle);
}
.pd-pricing-m {
    font: 600 var(--sa-text-md) var(--sa-font-body);
}
.pd-pricing-y {
    font: 500 var(--sa-text-xs) var(--sa-font-body);
    color: var(--sa-color-fg-subtle);
    margin-top: 2px;
}
.pd-impact-num {
    font: 700 var(--sa-text-lg) var(--sa-font-body);
}
.pd-impact-sub {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.pd-change-note {
    color: var(--sa-color-fg-subtle);
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
    font: 600 var(--sa-text-xs) var(--sa-font-mono);
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    border: 1px solid var(--sa-color-warning-border);
    white-space: nowrap;
}

/* diff */
.pd-diff-chips {
    display: flex;
    gap: 6px;
}
.pd-diff-chip {
    font: 700 var(--sa-text-xs) var(--sa-font-mono);
    padding: 3px 8px;
    border-radius: 6px;
}
.pd-diff-chip.add {
    background: var(--sa-color-positive-surface);
    color: var(--sa-color-positive-fg);
    border: 1px solid var(--sa-color-positive-border);
}
.pd-diff-chip.rm {
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-fg);
    border: 1px solid var(--sa-color-negative-border);
}
.pd-diff-chip.mod {
    background: var(--sa-color-border-soft);
    color: var(--sa-color-fg-secondary);
    border: 1px solid var(--sa-color-border);
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
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: 8px;
    padding: 11px 12px 11px 0;
    overflow: hidden;
}
.pd-diff-row.add {
    background: linear-gradient(
        90deg,
        var(--sa-color-positive-surface) 0%,
        var(--sa-color-bg-surface) 60%
    );
    border-color: var(--sa-color-positive-border);
}
.pd-diff-row.rm {
    background: linear-gradient(
        90deg,
        var(--sa-color-negative-surface) 0%,
        var(--sa-color-bg-surface) 60%
    );
    border-color: var(--sa-color-negative-border);
}
.pd-diff-row.mod {
    background: linear-gradient(
        90deg,
        var(--sa-color-bg-sunken) 0%,
        var(--sa-color-bg-surface) 60%
    );
    border-color: var(--sa-color-border);
}
.pd-diff-icon {
    width: 32px;
    align-self: stretch;
    display: grid;
    place-items: center;
    flex: 0 0 32px;
    color: var(--sa-color-fg-on-accent);
    font: 700 var(--sa-text-lg) var(--sa-font-body);
}
.pd-diff-row.add .pd-diff-icon {
    background: var(--sa-color-positive-strong);
}
.pd-diff-row.rm .pd-diff-icon {
    background: var(--sa-color-negative-strong);
}
.pd-diff-row.mod .pd-diff-icon {
    background: var(--sa-color-fg-muted);
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
    font: 700 var(--sa-text-2xs) var(--sa-font-mono);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--sa-color-fg-muted);
}
.pd-diff-label {
    font-size: var(--sa-text-md);
    font-weight: 600;
    color: var(--sa-color-fg-heading);
}
.pd-diff-key {
    font: 500 var(--sa-text-xs) var(--sa-font-mono);
    color: var(--sa-color-fg-subtle);
}
.pd-diff-vals {
    display: flex;
    align-items: center;
    gap: 6px;
    font: 500 var(--sa-text-sm) var(--sa-font-mono);
}
.pd-diff-strike {
    text-decoration: line-through;
    color: var(--sa-color-fg-subtle);
}
.pd-diff-arrow {
    color: var(--sa-color-fg-disabled);
}
.pd-diff-new {
    color: var(--sa-color-positive-fg);
    font-weight: 600;
}
.pd-diff-tag {
    margin-left: auto;
    font-size: var(--sa-text-xs);
    font-weight: 600;
    padding: 2px 9px;
    border-radius: 999px;
    border: 1px solid;
}
.pd-diff-tag.add {
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-positive-fg);
    border-color: var(--sa-color-positive-border);
}
.pd-diff-tag.rm {
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-negative-fg);
    border-color: var(--sa-color-negative-border);
}
.pd-diff-tag.mod {
    background: var(--sa-color-bg-surface);
    color: var(--sa-color-fg-secondary);
    border-color: var(--sa-color-border-strong);
}
.pd-diff-row.plain {
    background: var(--sa-color-bg-surface);
    border-color: var(--sa-color-border);
    padding: 11px 12px 11px 0;
}
.pd-diff-section {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
    padding: 0 2px;
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--sa-color-fg-subtle);
    font-weight: 700;
}
.pd-diff-section:first-child {
    margin-top: 0;
}
.pd-diff-section hr {
    flex: 1;
    border: 0;
    border-top: 1px dashed var(--sa-color-border);
}
.pd-diff-empty {
    padding: 28px 18px;
    text-align: center;
    color: var(--sa-color-fg-subtle);
    font-size: var(--sa-text-md);
}
.pd-diff-empty b {
    display: block;
    color: var(--sa-color-fg-secondary);
    font-size: var(--sa-text-lg);
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
    border-top: 1px solid var(--sa-color-border-soft);
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
    background: var(--sa-color-warning-strong);
}
.pd-audit-add {
    background: var(--sa-color-positive-strong);
}
.pd-audit-change {
    background: var(--sa-color-accent);
}
.pd-audit-publish {
    background: var(--sa-color-feature);
}
.pd-audit-remove {
    background: var(--sa-color-negative-strong);
}
.pd-audit-when {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    min-width: 130px;
}
.pd-audit-avatar {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--sa-color-inverse-bg);
    color: var(--sa-color-fg-on-accent);
    display: grid;
    place-items: center;
    font: 700 var(--sa-text-xs) var(--sa-font-body);
    flex: 0 0 auto;
}
.pd-audit-who {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-secondary);
    min-width: 64px;
}
.pd-audit-what {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-heading);
    flex: 1;
}

@media (max-width: 1180px) {
    .pd-body {
        grid-template-columns: 1fr;
    }
}
</style>

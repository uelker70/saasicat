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
import { isVersionEditable, type PlanRow, type PlanVersionRow } from '@saasicat/core';
import { formatCurrency } from '../../client/i18n/currency.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import PlanAuditLog from './internal/PlanAuditLog.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import PlanDetailKpis from './internal/PlanDetailKpis.vue';
import PlanTerminateDialog from './PlanTerminateDialog.vue';
import PlanVersionDiffPanel from './internal/PlanVersionDiffPanel.vue';
import PlanVersionsPanel from './internal/PlanVersionsPanel.vue';
import type {
    AuditRow,
    BundleEntry,
    DiffRow,
    DiscoveryQuota,
    FeatureMeta,
    PlanVersionDiff,
    PlanVersionEditability,
    PlanVersionStatus,
} from './internal/plan-detail.types.js';

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
    gap: var(--sa-space-3);
    padding: var(--sa-space-3) var(--sa-space-4);
    border-radius: var(--sa-radius-control);
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
    padding: var(--sa-space-2) var(--sa-space-3);
    font-size: var(--sa-text-sm);
    gap: var(--sa-space-2);
}
.chip {
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
    gap: var(--sa-space-5);
    align-items: start;
}
/* Surface, border and radius come from `.sa-section` — the panel IS one.
 * Only `overflow` stays, so content is clipped at the rounded edge. */
.pd-panel {
    overflow: hidden;
}
.pd-panel-head-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
}

/* timeline */
.pd-timeline {
    padding: var(--sa-space-4) var(--sa-space-5) var(--sa-space-2);
}
.pd-timeline-hint {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    margin-bottom: var(--sa-space-3);
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
    border-radius: var(--sa-radius-badge);
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
    padding: 0 var(--sa-space-3);
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
    /* Hatched from the two warning TINTS, not from the saturated amber.
     * `--sa-color-warning-strong` is a border and icon tone: it put the label
     * at 2.34:1 in light and 1.34:1 in dark on every second stripe. The tinted
     * pair is what the guide documents for text on a status surface, and what
     * `.live` above already uses. */
    background: repeating-linear-gradient(
        135deg,
        var(--sa-color-warning-surface) 0 8px,
        var(--sa-color-warning-surface-strong) 8px 16px
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
    margin-top: var(--sa-space-2);
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
    margin-top: var(--sa-space-4);
}
.pd-versions-head {
    display: contents;
}
.pd-versions-head > div {
    background: var(--sa-color-bg-surface-raised);
    padding: var(--sa-space-3) var(--sa-space-4);
    font-size: var(--sa-text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-muted);
    font-weight: 700;
    border-bottom: 1px solid var(--sa-color-border);
}
.pd-vrow {
    display: contents;
    cursor: pointer;
}
.pd-vrow > div {
    padding: var(--sa-space-4) var(--sa-space-4);
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
    gap: var(--sa-space-2);
    align-items: flex-start;
}
.pd-v-num {
    font: 700 var(--sa-text-lg) var(--sa-font-body);
}
.pd-validity {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-1);
}
.pd-validity-line {
    display: flex;
    align-items: center;
    gap: var(--sa-space-2);
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
    margin-top: var(--sa-space-1);
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
    gap: var(--sa-space-2);
    justify-content: flex-end;
    align-items: center;
}
.pd-endsat-badge {
    display: inline-flex;
    align-items: center;
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
    font: 600 var(--sa-text-xs) var(--sa-font-mono);
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    border: 1px solid var(--sa-color-warning-border);
    white-space: nowrap;
}

/* diff */
.pd-diff-chips {
    display: flex;
    gap: var(--sa-space-2);
}
.pd-diff-chip {
    font: 700 var(--sa-text-xs) var(--sa-font-mono);
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-badge);
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
    padding: var(--sa-space-4);
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-3);
}
.pd-diff-row {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-field);
    padding: var(--sa-space-4) var(--sa-space-4) var(--sa-space-4) 0;
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
/* The marker block at the head of a diff row.
 *
 * Every rule below carries BOTH halves of its pair, and that is deliberate:
 * the geometry used to live here and the background one rule further down,
 * which made neither rule judgeable on its own. `theme-role-contrast` needs a
 * background and a colour in the same body to measure anything, so the split
 * hid `--sa-color-fg-on-accent` on `--sa-color-positive-strong` — white on
 * green-500, 2.54:1, in BOTH themes — for as long as the component existed.
 *
 * A tint plus the tone's `-fg`, not a solid plus white: `-strong` is the rung
 * chosen to read as a COLOUR against its theme's surface, which puts it in the
 * middle of the lightness range — and nothing reads on the middle. That is
 * what `<tone>-fg` and `-surface-strong` are for. */
.pd-diff-icon {
    width: 32px;
    align-self: stretch;
    display: grid;
    place-items: center;
    flex: 0 0 32px;
    background: var(--sa-color-bg-sunken);
    color: var(--sa-color-fg-body);
    font: 700 var(--sa-text-lg) var(--sa-font-body);
}
.pd-diff-row.add .pd-diff-icon {
    background: var(--sa-color-positive-surface-strong);
    color: var(--sa-color-positive-fg);
}
.pd-diff-row.rm .pd-diff-icon {
    background: var(--sa-color-negative-surface-strong);
    color: var(--sa-color-negative-fg);
}
/* Unchanged, and deliberately not brought into line with the two above: it was
 * already readable (14.6:1) and `--sa-color-bg-sunken` is what the `mod` row
 * itself starts its gradient with, so a neutral tint here would leave the
 * marker with almost nothing to stand against in the light theme. It only
 * gains the foreground it was already inheriting, so the rule can be read. */
.pd-diff-row.mod .pd-diff-icon {
    background: var(--sa-color-inverse-surface);
    color: var(--sa-color-inverse-fg);
}
/* The single-version listing marks WHAT a row is rather than what changed, so
 * it reads the catalogue-entity roles. These three were the last colour
 * literals in a template: `style="background: #f59e0b"` and friends, painted
 * white by the base rule above at 2.15:1, 2.77:1 and 4.23:1. */
.pd-diff-row.plain .pd-diff-icon.feature {
    background: var(--sa-color-feature-surface);
    color: var(--sa-color-feature-fg);
}
.pd-diff-row.plain .pd-diff-icon.quota {
    background: var(--sa-color-quota-surface);
    color: var(--sa-color-quota-fg);
}
.pd-diff-row.plain .pd-diff-icon.bundle {
    background: var(--sa-color-bundle-surface);
    color: var(--sa-color-bundle-fg);
}
.pd-diff-body {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    flex-wrap: wrap;
}
.pd-diff-kind {
    font: 700 var(--sa-text-2xs) var(--sa-font-mono);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
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
    gap: var(--sa-space-2);
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
    padding: var(--sa-space-1) var(--sa-space-3);
    border-radius: var(--sa-radius-pill);
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
    padding: var(--sa-space-4) var(--sa-space-4) var(--sa-space-4) 0;
}
.pd-diff-section {
    display: flex;
    align-items: center;
    gap: var(--sa-space-3);
    margin-top: var(--sa-space-2);
    padding: 0 var(--sa-space-1);
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
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
    padding: var(--sa-space-7) var(--sa-space-5);
    text-align: center;
    color: var(--sa-color-fg-subtle);
    font-size: var(--sa-text-md);
}
.pd-diff-empty b {
    display: block;
    color: var(--sa-color-fg-secondary);
    font-size: var(--sa-text-lg);
    margin-bottom: var(--sa-space-2);
}

/* audit */
.pd-audit {
    margin-top: var(--sa-space-5);
}
.pd-audit-body {
    padding: var(--sa-space-2) var(--sa-space-5) var(--sa-space-4);
}
.pd-audit-row {
    display: flex;
    align-items: center;
    gap: var(--sa-space-4);
    padding: var(--sa-space-3) 0;
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

@media (max-width: 1023.98px) {
    .pd-body {
        grid-template-columns: 1fr;
    }
}
</style>

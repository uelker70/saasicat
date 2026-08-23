<template>
    <AdminPage class="sa-promo-codes">
        <AdminHero :title="msg.title" :subtitle="options?.subtitle">
            <template #actions>
                <slot name="head-options?.actions">
                    <q-btn
                        v-if="options?.enableCreate"
                        unelevated
                        no-caps
                        color="primary"
                        icon="add"
                        :label="resolvedCreateLabel"
                        @click="showCreate = true"
                    />
                </slot>
            </template>
        </AdminHero>

        <AdminBody>
            <AdminSection>
                <AdminStatistics :label="msg.title">
                    <AdminKpi
                        v-for="tile in statTiles"
                        :key="tile.id"
                        :label="tile.label"
                        :value="tile.count"
                        :sub="tile.hint"
                        :tone="tile.tone"
                        :selected="statusFilter === tile.id"
                        :action="() => onStatusTileClick(tile.id)"
                    />
                </AdminStatistics>
            </AdminSection>

            <AdminSection class="sa-promo-codes__card">
                <AdminFilters class="q-mb-lg">
                    <q-input
                        v-model="filter.search"
                        outlined
                        dense
                        :label="msg.list.searchLabel"
                        clearable
                    />
                    <q-select
                        v-model="filter.status"
                        outlined
                        dense
                        emit-value
                        map-options
                        clearable
                        :label="common.status"
                        :options="resolvedStatusOptions"
                    />
                </AdminFilters>

                <AdminTable
                    :rows="filteredRows"
                    :columns="effectiveColumns"
                    :loading="loading"
                    storage-key="promo-codes"
                >
                    <template #body-cell-status="{ row }">
                        <q-td>
                            <q-badge :color="statusColor(row.status)" :label="row.status" />
                        </q-td>
                    </template>
                    <template #row-actions="{ row }">
                        <slot name="row-actions" :row="row" :reload="reload">
                            <button
                                v-for="action in visibleActions(row)"
                                :key="action.id"
                                type="button"
                                class="sa-icon-btn"
                                :class="action.color === 'negative' ? 'sa-icon-btn--negative' : ''"
                                :title="action.label"
                                @click="action.handler(row)"
                            >
                                <q-icon :name="action.icon" size="18px" />
                            </button>
                        </slot>
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

        <PromoCodeCreateDialog
            v-if="options?.enableCreate"
            v-model="showCreate"
            :submit="promos.create"
            :plans="options?.planOptions"
            @created="onCreated"
        />

        <PromoCodeEditDialog
            v-if="options?.enableEdit"
            v-model="showEdit"
            :row="editingRow"
            :plans="options?.planOptions"
            :submit="promos.update"
            @updated="onUpdated"
        />
    </AdminPage>
</template>

<script lang="ts">
// Module-level exports — Vue 3 RFC #227 does NOT allow `export function` in
// `<script setup>` (the whole setup section is wrapped in setup()).
// Pure helpers + constants therefore live here in the regular `<script>` block.

import AdminTable from '../ui/data/AdminTable.vue';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { promoCodesResource } from '../client/resources/promo-codes.resource.js';
import { adminErrorMessage } from '../client/admin-error.js';
import type { PromoCodePlanOption } from '../internal/dialogs/types.js';

import { IDENTITY_ACCENTS } from '../client/identity-accents.js';

const PLAN_COLOR_PALETTE = IDENTITY_ACCENTS;

/**
 * Heuristic from a consumer wrapper: assigns each plan a stable color so plan
 * chips stay visually distinguishable. Consumers can use the util standalone.
 */
export function computePlanColors(
    plans: ReadonlyArray<{ key: string; label?: string }>,
): PromoCodePlanOption[] {
    return plans.map((p, idx) => ({
        key: p.key,
        label: p.label ?? p.key,
        color: PLAN_COLOR_PALETTE[idx % PLAN_COLOR_PALETTE.length],
    }));
}
</script>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminFilters from '../ui/page/AdminFilters.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminKpi from '../ui/data/AdminKpi.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminStatistics from '../ui/data/AdminStatistics.vue';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { useSuperAdminNotify } from '../quasar/notify.js';
import { useSuperAdminConfirm } from '../quasar/confirm.js';
import PromoCodeCreateDialog from '../internal/dialogs/PromoCodeCreateDialog.vue';
import PromoCodeEditDialog, {
    type PromoCodeEditRow,
} from '../internal/dialogs/PromoCodeEditDialog.vue';
import type {
    PromoCodeDurationType,
    PromoCodeUpdatePayload,
    PromoCodeValueType,
} from '../internal/dialogs/types.js';

// Platform standard page: promo codes. Data-agnostic.
//
// Optional baked-in flows: enableCreate/Edit/StatusToggle/Delete + submit*
// callbacks. Default actions are APPENDED to the consumer actions.

/**
 * A row as the page renders it.
 *
 * Looser than the port's `PromoCodeRecord` on purpose, and in one direction:
 * decimal and date fields arrive from JSON as strings, so the types that read
 * `Date` or `number` server-side are widened here rather than parsed twice.
 *
 * It had an `[extra: string]: unknown` escape hatch as well, from when the rows
 * came through a `loadPromos` prop and could be anything the app returned. The
 * resource decides the shape now, so the hatch is gone — and with it the reason
 * nothing could tell a typo from a field the server started sending.
 */
export interface PromoRow {
    id: string;
    code: string;
    valueType: 'PERCENT' | 'ABSOLUTE' | string;
    value: string | number;
    durationType?: PromoCodeDurationType | string;
    durationValue?: number | string | null;
    validFrom?: string | Date | null;
    status: 'ACTIVE' | 'PAUSED' | 'EXHAUSTED' | 'EXPIRED' | string;
    redemptionsCount: number;
    maxRedemptions: number | string | null;
    validUntil: string | Date | null;
    appliesToPlans?: string[];
    appliesToBilling?: 'MONTHLY' | 'YEARLY' | string | null;
    firstTimeCustomersOnly?: boolean;
    minimumPlanAmountGross?: number | string | null;
    allowZeroInvoice?: boolean;
    campaignTag: string | null;
    revenueDeductionAccount?: string | null;
    description?: string | null;
}

export interface PromoListFilter {
    search?: string;
    status?: string | null;
}

/**
 * What an app may change about this page.
 *
 * One object rather than 11 props, per AP3 §3.2: a page's contract is
 * `resources`, `params` and `options`, whatever the number of knobs behind
 * the last one.
 */
export interface PromoCodesPageOptions {
    subtitle?: string;
    statusOptions?: readonly string[];
    actions?: readonly PromoRowAction[];
    enableCreate?: boolean;
    enableEdit?: boolean;
    enableStatusToggle?: boolean;
    enableDelete?: boolean;
    planOptions?: readonly PromoCodePlanOption[];
    createLabel?: string;
}

export interface PromoRowAction {
    id: string;
    label: string;
    icon: string;
    color?: string;
    condition?: (row: PromoRow) => boolean;
    handler: (row: PromoRow) => void;
}

const props = defineProps<{
    /**
     * Override the promo-code resource for this page only — a different
     * host, or one operation wrapped. Layered over the app's own override
     * rather than replacing it; see AP3 §3.2.
     */
    resources?: ResourceOverride<(typeof promoCodesResource)['ops']>;
    /** Presentation and capability. Never data, never a callback. */
    options?: PromoCodesPageOptions;
}>();

const msg = useSaMessages('promos');
const errors = useSaMessages('errors');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();
const resolvedCreateLabel = computed(() => props.options?.createLabel ?? msg.value.createAction);

// The data layer, reached by name. Before this the page took four function
// props and every consumer app spelled the same four endpoints again; the
// resource already knows the API base, the project and the locale.
const promos = useResource('promoCodes', props.resources);

// The four the endpoint can answer with. `withDefaults` carried this list
// before the props were grouped into `options`; without it the status filter
// is a dropdown that opens on nothing.
const DEFAULT_STATUS_OPTIONS = ['ACTIVE', 'PAUSED', 'EXHAUSTED', 'EXPIRED'] as const;
const resolvedStatusOptions = computed<readonly string[]>(
    () => props.options?.statusOptions ?? DEFAULT_STATUS_OPTIONS,
);

const notify = useSuperAdminNotify();
// `confirm` is taken — `window.confirm` shadows it.
const askConfirm = useSuperAdminConfirm();
const rows = ref<PromoRow[]>([]);
const loading = ref(false);
const filter = reactive({ search: '', status: null as string | null });
const showCreate = ref(false);
const showEdit = ref(false);
const editingRow = ref<PromoCodeEditRow | null>(null);

// Stat-pill filter (analogous to the plan simulation promo-codes.jsx):
//   all | active | scheduled | paused | expired.
// 'scheduled' = ACTIVE + validFrom in the future; without a validFrom field in
// PromoRow we use the PENDING status as fallback. Consumers may pass the
// `scheduledAt` or `validFrom` field on-the-fly in the row.
type StatusFilter = 'all' | 'active' | 'scheduled' | 'paused' | 'expired';
const statusFilter = ref<StatusFilter>('all');

function classifyRow(row: PromoRow): Exclude<StatusFilter, 'all'> | null {
    const status = String(row.status ?? '').toUpperCase();
    if (status === 'PAUSED') return 'paused';
    if (status === 'EXPIRED' || status === 'EXHAUSTED') return 'expired';
    const validFrom =
        typeof row.validFrom === 'string' || row.validFrom instanceof Date ? row.validFrom : null;
    if (validFrom) {
        const t = new Date(validFrom as string | Date).getTime();
        if (!Number.isNaN(t) && t > Date.now()) return 'scheduled';
    }
    if (status === 'SCHEDULED' || status === 'PENDING') return 'scheduled';
    if (status === 'ACTIVE') return 'active';
    return null;
}

// The table narrows; the tiles above it deliberately do not — see statTiles.
const filteredRows = computed(() => {
    // `clearable` emits null, not '' — see Quasar's use-field clearValue().
    const q = (filter.search ?? '').trim().toLowerCase();
    const status = filter.status?.toUpperCase() ?? null;

    return rows.value.filter((row) => {
        if (statusFilter.value !== 'all' && classifyRow(row) !== statusFilter.value) return false;
        if (status && String(row.status ?? '').toUpperCase() !== status) return false;
        if (!q) return true;
        return [row.code, row.description, row.campaignTag]
            .filter((v): v is string => typeof v === 'string')
            .some((v) => v.toLowerCase().includes(q));
    });
});

// Absolute counts over everything the tenant has, deliberately independent of
// the filter below: these tiles are the status filter, so counting the filtered
// set would drop every unselected tile to zero the moment one is picked.
const statTiles = computed<
    Array<{
        id: StatusFilter;
        label: string;
        count: number;
        tone?: 'positive' | 'info' | 'warn' | 'muted';
        hint?: string;
    }>
>(() => {
    const counts = { active: 0, scheduled: 0, paused: 0, expired: 0 };
    for (const r of rows.value) {
        const c = classifyRow(r);
        if (c) counts[c]++;
    }
    return [
        { id: 'all', label: common.value.all, count: rows.value.length },
        {
            id: 'active',
            label: common.value.active,
            count: counts.active,
            tone: 'positive',
            hint: msg.value.list.hintRedeemable,
        },
        {
            id: 'scheduled',
            label: msg.value.list.tileScheduled,
            count: counts.scheduled,
            tone: 'info',
            hint: msg.value.list.hintStartsLater,
        },
        { id: 'paused', label: msg.value.list.tilePaused, count: counts.paused, tone: 'warn' },
        { id: 'expired', label: common.value.expired, count: counts.expired, tone: 'muted' },
    ];
});

function onStatusTileClick(id: StatusFilter): void {
    statusFilter.value = id;
}

const baseColumns = computed(() => [
    {
        name: 'code',
        label: msg.value.list.columnCode,
        field: 'code',
        align: 'left' as const,
        sortable: true,
    },
    {
        name: 'valueType',
        label: common.value.type,
        field: 'valueType',
        align: 'left' as const,
    },
    { name: 'value', label: msg.value.list.columnValue, field: 'value', align: 'right' as const },
    { name: 'status', label: common.value.status, field: 'status', align: 'left' as const },
    {
        name: 'redemptions',
        label: msg.value.list.columnRedemptions,
        field: (r: PromoRow) => `${r.redemptionsCount} / ${r.maxRedemptions ?? '∞'}`,
        align: 'right' as const,
    },
    {
        name: 'campaign',
        label: msg.value.list.columnCampaign,
        field: (r: PromoRow) => r.campaignTag ?? '—',
        align: 'left' as const,
    },
    {
        name: 'validUntil',
        label: msg.value.list.columnValidUntil,
        field: (r: PromoRow) => formatDate(r.validUntil) ?? '—',
        align: 'left' as const,
    },
]);

// Built-in default actions — APPENDED to the consumer actions, not replacing them.
const bakedActions = computed<PromoRowAction[]>(() => {
    const out: PromoRowAction[] = [];
    if (props.options?.enableEdit) {
        out.push({
            id: 'edit',
            label: common.value.edit,
            icon: 'edit',
            color: 'primary',
            handler: (row) => openEdit(row),
        });
    }
    if (props.options?.enableStatusToggle) {
        out.push({
            id: 'pause',
            label: msg.value.list.actionPause,
            icon: 'pause',
            color: 'warning',
            condition: (row) => row.status === 'ACTIVE',
            handler: (row) => onPatch(row, { status: 'PAUSED' }),
        });
        out.push({
            id: 'activate',
            label: msg.value.list.actionActivate,
            icon: 'play_arrow',
            color: 'primary',
            condition: (row) => row.status === 'PAUSED',
            handler: (row) => onPatch(row, { status: 'ACTIVE' }),
        });
    }
    if (props.options?.enableDelete) {
        out.push({
            id: 'delete',
            label: common.value.delete,
            icon: 'delete',
            color: 'negative',
            handler: (row) => onDeleteClick(row),
        });
    }
    return out;
});

const mergedActions = computed<readonly PromoRowAction[]>(() => [
    ...(props.options?.actions ?? []),
    ...bakedActions.value,
]);

const effectiveColumns = computed(() => {
    const cols = [...baseColumns.value];
    return cols;
});

function visibleActions(row: PromoRow): PromoRowAction[] {
    return mergedActions.value.filter((a) => !a.condition || a.condition(row));
}

function statusColor(status: string): string {
    if (status === 'ACTIVE') return 'positive';
    if (status === 'PAUSED') return 'amber-7';
    if (status === 'EXPIRED') return 'grey';
    return 'negative';
}

async function reload() {
    loading.value = true;
    try {
        // Unfiltered on purpose: the tiles count the tenant's full set, and
        // the table narrows locally, so filtering costs no round trip.
        rows.value = await promos.list({});
    } catch (err) {
        rows.value = [];
        console.warn('[PromoCodesPage] loading promo codes failed:', err);
    } finally {
        loading.value = false;
    }
}

defineExpose({ reload });

onMounted(reload);

function openEdit(row: PromoRow): void {
    editingRow.value = {
        id: row.id,
        code: row.code,
        status: row.status,
        valueType: normalizeValueType(row.valueType),
        value: normalizeNumber(row.value),
        durationType: normalizeDurationType(row.durationType),
        durationValue: normalizeNullableNumber(row.durationValue),
        validFrom: normalizeDateString(row.validFrom),
        validUntil: normalizeDateString(row.validUntil),
        maxRedemptions: normalizeNullableNumber(row.maxRedemptions),
        redemptionsCount: normalizeNumber(row.redemptionsCount) ?? 0,
        appliesToPlans: normalizeStringArray(row.appliesToPlans),
        appliesToBilling: normalizeBilling(row.appliesToBilling),
        firstTimeCustomersOnly:
            typeof row.firstTimeCustomersOnly === 'boolean' ? row.firstTimeCustomersOnly : false,
        minimumPlanAmountGross: normalizeNullableNumber(row.minimumPlanAmountGross),
        allowZeroInvoice: typeof row.allowZeroInvoice === 'boolean' ? row.allowZeroInvoice : false,
        campaignTag: typeof row.campaignTag === 'string' ? row.campaignTag : null,
        revenueDeductionAccount:
            typeof row.revenueDeductionAccount === 'string' ? row.revenueDeductionAccount : null,
        description: typeof row.description === 'string' ? row.description : null,
    };
    showEdit.value = true;
}

function normalizeValueType(value: unknown): PromoCodeValueType | undefined {
    return value === 'PERCENT' || value === 'ABSOLUTE' ? value : undefined;
}

function normalizeDurationType(value: unknown): PromoCodeDurationType | undefined {
    return value === 'ONCE' || value === 'MONTHS' || value === 'BILLING_CYCLES' ? value : undefined;
}

function normalizeBilling(value: unknown): 'MONTHLY' | 'YEARLY' | null {
    return value === 'MONTHLY' || value === 'YEARLY' ? value : null;
}

function normalizeNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function normalizeNullableNumber(value: unknown): number | null {
    return normalizeNumber(value) ?? null;
}

function normalizeDateString(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    return null;
}

function normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function onPatch(row: PromoRow, data: PromoCodeUpdatePayload): Promise<void> {
    try {
        await promos.update(row.id, data);
        notify('positive', `${row.code} → ${data.status}`);
        await reload();
    } catch (err) {
        notify('negative', adminErrorMessage(err, errors.value));
    }
}

async function onDeleteClick(row: PromoRow): Promise<void> {
    const { ok: confirmed } = await askConfirm({
        title: formatMessage(msg.value.list.deleteTitle, { code: row.code }),
        message: msg.value.list.deleteMessage,
        confirmLabel: common.value.delete,
        cancelLabel: common.value.cancel,
        tone: 'negative',
    });
    if (confirmed) {
        try {
            await promos.remove(row.id);
            notify('positive', formatMessage(msg.value.list.deletedNotice, { code: row.code }));
            await reload();
        } catch (err) {
            notify('negative', adminErrorMessage(err, errors.value));
        }
    }
}

function onCreated(): void {
    notify('positive', msg.value.list.createdNotice);
    void reload();
}

function onUpdated(): void {
    notify('positive', msg.value.list.updatedNotice);
    void reload();
}

function formatDate(iso: string | Date | null | undefined): string | null {
    if (!iso) return null;
    try {
        return new Date(iso).toLocaleDateString(intlLocale.value, {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return String(iso);
    }
}
</script>

<style scoped></style>

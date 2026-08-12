<template>
    <AdminPage class="sa-promo-detail">
        <AdminHero :title="data?.promo.code ?? labels.promoCode">
            <template #before-title>
                <q-btn
                    flat
                    dense
                    icon="arrow_back"
                    :label="labels.back"
                    :to="backRoute"
                    class="sa-promo-detail__back"
                />
            </template>
            <template #subtitle>
                <template v-if="data">
                    {{ data.promo.valueType }} · {{ data.promo.value }} ·
                    <q-badge
                        :color="resolveStatusColor(String(data.promo.status))"
                        :label="String(data.promo.status)"
                    />
                </template>
                <template v-else>—</template>
            </template>
            <template #actions>
                <button
                    class="sa-btn sa-btn--primary"
                    type="button"
                    v-if="editSubmit && data"
                    @click="openEdit"
                >
                    <q-icon name="edit" size="16px" />
                    <span>{{ labels.edit }}</span>
                </button>
                <slot name="header-actions" />
            </template>
        </AdminHero>

        <AdminBody
            :loading="loading"
            :empty="!data"
            :loading-text="msg.detail.loading"
            :empty-text="labels.empty"
        >
            <template v-if="data">
                <AdminSection :title="labels.config">
                    <slot name="config" :promo="data.promo">
                        <pre class="sa-promo-detail__kv">{{ resolveFormatPromo(data.promo) }}</pre>
                    </slot>
                </AdminSection>

                <AdminSection :title="labels.stats">
                    <slot name="stats" :stats="data.stats">
                        <pre class="sa-promo-detail__kv">{{
                            JSON.stringify(data.stats, null, 2)
                        }}</pre>
                    </slot>
                </AdminSection>

                <AdminSection :title="`${labels.redemptions} (${data.redemptions.length})`">
                    <slot name="redemptions" :redemptions="data.redemptions">
                        <q-table
                            flat
                            :rows="pagedRows"
                            :columns="redemptionsColumns ?? defaultColumns"
                            row-key="id"
                            hide-pagination
                        />

                        <AdminPaginator
                            storage-key="promo-code-redemptions"
                            v-model:page="page"
                            v-model:rows-per-page="rowsPerPage"
                            :total="total"
                        />
                    </slot>
                </AdminSection>

                <slot name="extra-sections" :data="data" />
            </template>
        </AdminBody>

        <PromoCodeEditDialog
            v-if="editSubmit"
            v-model="editOpen"
            :row="editRow"
            :plans="editPlans ?? []"
            :submit="editSubmit"
            @updated="onEditUpdated"
        />
    </AdminPage>
</template>

<script setup lang="ts">
import { usePagination } from '../vue/use-pagination.js';
import AdminPaginator from '../components/admin-page/AdminPaginator.vue';
import { computed, onMounted, ref } from 'vue';
import AdminBody from '../components/admin-page/AdminBody.vue';
import AdminHero from '../components/admin-page/AdminHero.vue';
import AdminSection from '../components/admin-page/AdminSection.vue';
import AdminPage from '../components/admin-page/AdminPage.vue';
import type { RouteLocationRaw } from 'vue-router';
import type { QTableColumn } from 'quasar';
import PromoCodeEditDialog, {
    type PromoCodeEditRow,
} from '../components/dialogs/PromoCodeEditDialog.vue';
import type { PromoCodePlanOption, PromoCodeUpdatePayload } from '../components/dialogs/types.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

export interface PromoDetailData {
    promo: Record<string, unknown> & {
        code?: string;
        valueType?: string;
        value?: number | string;
        status?: string;
    };
    stats: Record<string, unknown>;
    redemptions: Array<Record<string, unknown> & { id: string }>;
}

const props = defineProps<{
    loadDetail: () => Promise<PromoDetailData>;
    backRoute: RouteLocationRaw;
    backLabel?: string;
    promoCodeLabel?: string;
    configLabel?: string;
    statsLabel?: string;
    redemptionsLabel?: string;
    emptyLabel?: string;
    redemptionsColumns?: QTableColumn[];
    /**
     * Maps a status string to a Quasar color name. Default: ACTIVE→positive,
     * PAUSED→amber-7, EXPIRED→grey, else negative.
     */
    statusColor?: (status: string) => string;
    /**
     * Optional formatter for the Konfiguration JSON block. Default:
     * `JSON.stringify(promo, null, 2)` — the consumer can pass a curated
     * subset (e.g. only marketing-relevant fields).
     */
    formatPromo?: (promo: Record<string, unknown>) => string;
    /**
     * When set: enables the "Edit" button in the header and opens the
     * {@link PromoCodeEditDialog}. The consumer provides the app-specific
     * PATCH function (e.g. `adminApi.promoCodes.update`). After a
     * successful save, the detail page automatically reloads via
     * `loadDetail()` — the consumer needs to trigger nothing further.
     */
    editSubmit?: (id: string, payload: PromoCodeUpdatePayload) => Promise<void>;
    editLabel?: string;
    /**
     * Plan list for the plan picker in the edit dialog. When empty, the
     * dialog hides the plan selection.
     */
    editPlans?: readonly PromoCodePlanOption[];
}>();

const msg = useSaMessages('promos');
const common = useSaMessages('common');

const labels = computed(() => ({
    back: props.backLabel ?? common.value.back,
    promoCode: props.promoCodeLabel ?? msg.value.detail.promoCodeLabel,
    config: props.configLabel ?? msg.value.detail.configLabel,
    stats: props.statsLabel ?? msg.value.detail.statsLabel,
    redemptions: props.redemptionsLabel ?? msg.value.detail.redemptionsLabel,
    empty: props.emptyLabel ?? msg.value.detail.emptyLabel,
    edit: props.editLabel ?? common.value.edit,
}));

const data = ref<PromoDetailData | null>(null);
const loading = ref(false);
const editOpen = ref(false);

async function reload() {
    loading.value = true;
    try {
        data.value = await props.loadDetail();
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void reload();
});

const editRow = computed<PromoCodeEditRow | null>(() => {
    if (!data.value) return null;
    const p = data.value.promo as Record<string, unknown>;
    const id = typeof p.id === 'string' ? p.id : '';
    if (!id) return null;
    const plans = Array.isArray(p.appliesToPlans)
        ? (p.appliesToPlans as unknown[]).filter((k): k is string => typeof k === 'string')
        : [];
    const billing = p.appliesToBilling;
    return {
        id,
        code: String(p.code ?? ''),
        status: String(p.status ?? 'ACTIVE'),
        valueType: p.valueType === 'ABSOLUTE' ? 'ABSOLUTE' : 'PERCENT',
        value:
            typeof p.value === 'number'
                ? p.value
                : typeof p.value === 'string'
                  ? Number(p.value) || 0
                  : 0,
        durationType:
            p.durationType === 'MONTHS' || p.durationType === 'BILLING_CYCLES'
                ? p.durationType
                : 'ONCE',
        durationValue: typeof p.durationValue === 'number' ? p.durationValue : null,
        validFrom: typeof p.validFrom === 'string' ? p.validFrom : null,
        validUntil: typeof p.validUntil === 'string' ? p.validUntil : null,
        maxRedemptions: typeof p.maxRedemptions === 'number' ? p.maxRedemptions : null,
        redemptionsCount: typeof p.redemptionsCount === 'number' ? p.redemptionsCount : 0,
        appliesToPlans: plans,
        appliesToBilling: billing === 'MONTHLY' || billing === 'YEARLY' ? billing : null,
        firstTimeCustomersOnly:
            typeof p.firstTimeCustomersOnly === 'boolean' ? p.firstTimeCustomersOnly : false,
        minimumPlanAmountGross:
            typeof p.minimumPlanAmountGross === 'number'
                ? p.minimumPlanAmountGross
                : typeof p.minimumPlanAmountGross === 'string'
                  ? Number(p.minimumPlanAmountGross) || null
                  : null,
        allowZeroInvoice: typeof p.allowZeroInvoice === 'boolean' ? p.allowZeroInvoice : false,
        campaignTag: typeof p.campaignTag === 'string' ? p.campaignTag : null,
        revenueDeductionAccount:
            typeof p.revenueDeductionAccount === 'string' ? p.revenueDeductionAccount : null,
        description: typeof p.description === 'string' ? p.description : null,
    };
});

function openEdit() {
    if (!editRow.value) return;
    editOpen.value = true;
}

async function onEditUpdated() {
    await reload();
}

function resolveStatusColor(s: string): string {
    if (props.statusColor) return props.statusColor(s);
    if (s === 'ACTIVE') return 'positive';
    if (s === 'PAUSED') return 'amber-7';
    if (s === 'EXPIRED') return 'grey';
    return 'negative';
}

function resolveFormatPromo(promo: Record<string, unknown>): string {
    if (props.formatPromo) return props.formatPromo(promo);
    return JSON.stringify(promo, null, 2);
}

const defaultColumns = computed<QTableColumn[]>(() => [
    {
        name: 'tenant',
        label: msg.value.detail.columnTenant,
        field: (r: unknown) =>
            ((r as Record<string, unknown>).tenant as { slug?: string } | undefined)?.slug ?? '—',
        align: 'left',
    },
    { name: 'status', label: common.value.status, field: 'status', align: 'left' },
    {
        name: 'startsAt',
        label: msg.value.detail.columnStart,
        field: (r: unknown) => String((r as Record<string, unknown>).startsAt ?? '').slice(0, 10),
        align: 'left',
    },
    {
        name: 'endsAt',
        label: msg.value.detail.columnEnd,
        field: (r: unknown) => {
            const v = (r as Record<string, unknown>).endsAt;
            return v ? String(v).slice(0, 10) : '∞';
        },
        align: 'left',
    },
    {
        name: 'redeemedAt',
        label: msg.value.detail.columnRedeemedAt,
        field: (r: unknown) =>
            String((r as Record<string, unknown>).redeemedAt ?? '')
                .slice(0, 19)
                .replace('T', ' '),
        align: 'left',
    },
]);

const redemptionRows = computed(() => data.value?.redemptions ?? []);
const { page, rowsPerPage, total, pagedRows } = usePagination(redemptionRows);
</script>

<style scoped>
.sa-promo-detail__back {
    margin-bottom: 6px;
}
.sa-promo-detail__head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
}
.sa-promo-detail__body {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.sa-promo-detail__kv {
    background: #fafbfc;
    border: 1px solid var(--sa-border);
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
    margin: 0;
    overflow-x: auto;
    font-family: var(--sa-font-mono);
}
</style>

<template>
    <AdminPage class="sa-promo-detail">
        <AdminHero :title="data?.promo?.code ?? labels.promoCode">
            <template #before-title>
                <q-btn
                    flat
                    dense
                    icon="arrow_back"
                    :label="labels.back"
                    :to="options?.backRoute"
                    class="sa-promo-detail__back"
                />
            </template>
            <template #subtitle>
                <template v-if="data">
                    {{ data.promo.valueType }} · {{ data.promo.value }} ·
                    <q-badge
                        :tone="resolveStatusTone(String(data.promo.status))"
                        :label="String(data.promo.status)"
                    />
                </template>
                <template v-else>—</template>
            </template>
            <template #actions>
                <button v-if="data" class="sa-btn sa-btn--primary" type="button" @click="openEdit">
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
                        <AdminTable
                            :rows="redemptionRows"
                            :columns="options?.redemptionsColumns ?? defaultColumns"
                            storage-key="promo-code-redemptions"
                        />
                    </slot>
                </AdminSection>

                <slot name="extra-sections" :data="data" />
            </template>
        </AdminBody>

        <PromoCodeEditDialog
            v-model="editOpen"
            :row="editRow"
            :plans="options?.editPlans ?? []"
            :submit="promos.update"
            @updated="onEditUpdated"
        />
    </AdminPage>
</template>

<script setup lang="ts">
import AdminTable from '../ui/data/AdminTable.vue';
import { useRoute } from 'vue-router';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { promoCodesResource } from '../client/resources/promo-codes.resource.js';
import type { PromoDetail as PromoDetailData } from '../client/resources/promo-codes.resource.js';
import { promoStatusTone, type PillTone } from '../vue/status.js';
import type { PromoCodeStatus } from '@saasicat/types';
import { computed, onMounted, ref } from 'vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import type { RouteLocationRaw } from 'vue-router';
import type { QTableColumn } from 'quasar';
import PromoCodeEditDialog, {
    type PromoCodeEditRow,
} from '../internal/dialogs/PromoCodeEditDialog.vue';
import type { PromoCodePlanOption } from '../internal/dialogs/types.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

export type { PromoDetail as PromoDetailData } from '../client/resources/promo-codes.resource.js';

/**
 * What an app may change about this page.
 *
 * One object rather than 15 props, per AP3 §3.2: a page's contract is
 * `resources`, `params` and `options`, whatever the number of knobs behind
 * the last one.
 */
export interface PromoCodeDetailPageOptions {
    backRoute: RouteLocationRaw;
    backLabel?: string;
    promoCodeLabel?: string;
    configLabel?: string;
    statsLabel?: string;
    redemptionsLabel?: string;
    emptyLabel?: string;
    redemptionsColumns?: QTableColumn[];
    editLabel?: string;
    /**
     * Plan list for the plan picker in the edit dialog. When empty, the
     * dialog hides the plan selection.
     */
    editPlans?: readonly PromoCodePlanOption[];
}

const props = defineProps<{
    /**
     * Which promo code. Defaults to the route's `id` param — an app only passes
     * this when it mounts the page outside a detail route.
     */
    id?: string;
    /**
     * Override the promo-code resource for this page only. Layered over the
     * app's own override; see AP3 §3.2.
     */
    resources?: ResourceOverride<(typeof promoCodesResource)['ops']>;
    /** Presentation and capability. Never data, never a callback. */
    options?: PromoCodeDetailPageOptions;
}>();

const msg = useSaMessages('promos');
const common = useSaMessages('common');

const labels = computed(() => ({
    back: props.options?.backLabel ?? common.value.back,
    promoCode: props.options?.promoCodeLabel ?? msg.value.detail.promoCodeLabel,
    config: props.options?.configLabel ?? msg.value.detail.configLabel,
    stats: props.options?.statsLabel ?? msg.value.detail.statsLabel,
    redemptions: props.options?.redemptionsLabel ?? msg.value.detail.redemptionsLabel,
    empty: props.options?.emptyLabel ?? msg.value.detail.emptyLabel,
    edit: props.options?.editLabel ?? common.value.edit,
}));

const data = ref<PromoDetailData | null>(null);
const loading = ref(false);
const editOpen = ref(false);

// The data layer, reached by name. The page used to take a pre-bound
// `loadDetail`, so every consumer wrote a closure over the route param.
const promos = useResource('promoCodes', props.resources);
const route = useRoute();
// `promo-codes/:code` is what `pages/index.ts` declares, so `code` is what the
// router puts in `params`. Reading `id` here — the name the page carried before
// it became a standard route — left every navigation asking the server for
// `/promo-codes/`, which is the list, not the code the operator clicked.
const promoId = computed(() => props.id ?? String(route.params.code ?? ''));

async function reload() {
    loading.value = true;
    try {
        // A body without a promo is a promo that is not there — a code the
        // operator mistyped, or one deleted between the list and the click.
        // Kept as `null` so the empty state below renders it: the page used to
        // take a `{}` as data, and every read under it threw while mounting.
        const detail = await promos.detail(promoId.value);
        data.value = detail?.promo ? detail : null;
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

/**
 * The tone a status renders in — the platform's one mapping, not a per-page
 * one. This used to be an overridable `statusColor` prop whose default fell
 * through to red for `EXHAUSTED`, so a fully redeemed code looked like a fault.
 */
function resolveStatusTone(s: string): PillTone {
    return promoStatusTone(s as PromoCodeStatus);
}

function resolveFormatPromo(promo: Record<string, unknown>): string {
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
    background: var(--sa-color-bg-surface-raised);
    border: 1px solid var(--sa-color-border);
    border-radius: 8px;
    padding: 12px;
    font-size: var(--sa-text-sm);
    margin: 0;
    overflow-x: auto;
    font-family: var(--sa-font-mono);
}
</style>

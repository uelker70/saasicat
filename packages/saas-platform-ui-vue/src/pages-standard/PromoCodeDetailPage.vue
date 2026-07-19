<template>
    <div class="sa-promo-detail">
        <header class="sa-page-head">
            <div>
                <q-btn
                    flat
                    dense
                    icon="arrow_back"
                    :label="backLabel"
                    :to="backRoute"
                    class="sa-promo-detail__back"
                />
                <h1 class="sa-page-head__title">{{ data?.promo.code ?? promoCodeLabel }}</h1>
                <p class="sa-page-head__sub">
                    <template v-if="data">
                        {{ data.promo.valueType }} · {{ data.promo.value }} ·
                        <q-badge
                            :color="resolveStatusColor(String(data.promo.status))"
                            :label="String(data.promo.status)"
                        />
                    </template>
                    <template v-else>—</template>
                </p>
            </div>
            <div class="sa-promo-detail__head-actions">
                <q-btn
                    v-if="editSubmit && data"
                    color="primary"
                    unelevated
                    icon="edit"
                    :label="editLabel"
                    @click="openEdit"
                />
                <slot name="header-actions" />
            </div>
        </header>

        <div class="sa-promo-detail__body">
            <div v-if="loading" class="sa-promo-detail__state">
                <q-spinner size="32px" /> wird geladen…
            </div>
            <div v-else-if="!data" class="sa-promo-detail__state">{{ emptyLabel }}</div>

            <template v-else>
                <div class="sa-card sa-promo-detail__section">
                    <div class="sa-promo-detail__section-head">{{ configLabel }}</div>
                    <slot name="config" :promo="data.promo">
                        <pre class="sa-promo-detail__kv">{{ resolveFormatPromo(data.promo) }}</pre>
                    </slot>
                </div>

                <div class="sa-card sa-promo-detail__section">
                    <div class="sa-promo-detail__section-head">{{ statsLabel }}</div>
                    <slot name="stats" :stats="data.stats">
                        <pre class="sa-promo-detail__kv">{{
                            JSON.stringify(data.stats, null, 2)
                        }}</pre>
                    </slot>
                </div>

                <div class="sa-card sa-promo-detail__section">
                    <div class="sa-promo-detail__section-head">
                        {{ redemptionsLabel }} ({{ data.redemptions.length }})
                    </div>
                    <slot name="redemptions" :redemptions="data.redemptions">
                        <q-table
                            flat
                            :rows="data.redemptions"
                            :columns="redemptionsColumns ?? DEFAULT_COLUMNS"
                            row-key="id"
                            :pagination="{ rowsPerPage: 0 }"
                            hide-pagination
                        />
                    </slot>
                </div>

                <slot name="extra-sections" :data="data" />
            </template>
        </div>

        <PromoCodeEditDialog
            v-if="editSubmit"
            v-model="editOpen"
            :row="editRow"
            :plans="editPlans ?? []"
            :submit="editSubmit"
            @updated="onEditUpdated"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import type { QTableColumn } from 'quasar';
import PromoCodeEditDialog, {
    type PromoCodeEditRow,
} from '../components/dialogs/PromoCodeEditDialog.vue';
import type { PromoCodePlanOption, PromoCodeUpdatePayload } from '../components/dialogs/types.js';

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

const props = withDefaults(
    defineProps<{
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
         * subset (z. B. nur Marketing-relevante Felder).
         */
        formatPromo?: (promo: Record<string, unknown>) => string;
        /**
         * Wenn gesetzt: aktiviert den „Bearbeiten"-Button im Header und
         * öffnet den {@link PromoCodeEditDialog}. Der Konsument liefert die
         * App-spezifische PATCH-Funktion (z. B. `adminApi.promoCodes.update`).
         * Nach erfolgreichem Speichern lädt die Detail-Page automatisch
         * `loadDetail()` neu — Konsument muss nichts weiter triggern.
         */
        editSubmit?: (id: string, payload: PromoCodeUpdatePayload) => Promise<void>;
        editLabel?: string;
        /**
         * Plan-Liste für den Plan-Picker im Edit-Dialog. Wenn leer, blendet
         * der Dialog die Plan-Auswahl aus.
         */
        editPlans?: readonly PromoCodePlanOption[];
    }>(),
    {
        backLabel: 'Zurück',
        promoCodeLabel: 'Promo-Code',
        configLabel: 'Konfiguration',
        statsLabel: 'Statistik',
        redemptionsLabel: 'Einlösungen',
        emptyLabel: 'Code nicht gefunden.',
        editLabel: 'Bearbeiten',
    },
);

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

const DEFAULT_COLUMNS: QTableColumn[] = [
    {
        name: 'tenant',
        label: 'Tenant',
        field: (r: unknown) =>
            ((r as Record<string, unknown>).tenant as { slug?: string } | undefined)?.slug ?? '—',
        align: 'left',
    },
    { name: 'status', label: 'Status', field: 'status', align: 'left' },
    {
        name: 'startsAt',
        label: 'Start',
        field: (r: unknown) => String((r as Record<string, unknown>).startsAt ?? '').slice(0, 10),
        align: 'left',
    },
    {
        name: 'endsAt',
        label: 'Ende',
        field: (r: unknown) => {
            const v = (r as Record<string, unknown>).endsAt;
            return v ? String(v).slice(0, 10) : '∞';
        },
        align: 'left',
    },
    {
        name: 'redeemedAt',
        label: 'Eingelöst',
        field: (r: unknown) =>
            String((r as Record<string, unknown>).redeemedAt ?? '')
                .slice(0, 19)
                .replace('T', ' '),
        align: 'left',
    },
];
</script>

<style scoped>
.sa-promo-detail {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app);
}
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
    padding: 12px 28px 28px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.sa-promo-detail__section {
    padding: 16px 18px;
}
.sa-promo-detail__section-head {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--sa-muted);
    text-transform: uppercase;
    margin-bottom: 10px;
    font-family: var(--sa-font-head);
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
.sa-promo-detail__state {
    padding: 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--sa-muted);
}
</style>

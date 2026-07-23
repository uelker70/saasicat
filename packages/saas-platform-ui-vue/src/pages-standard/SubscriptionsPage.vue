<template>
    <div class="sa-subscriptions">
        <header class="sa-subscriptions__head">
            <div>
                <h1 class="sa-subscriptions__title">{{ msg.subscriptions.title }}</h1>
                <p v-if="subtitle" class="sa-subscriptions__sub">{{ subtitle }}</p>
            </div>
            <slot name="head-actions" />
        </header>

        <div class="sa-subscriptions__body">
            <div class="sa-subscriptions__card">
                <q-table
                    flat
                    :rows="rows"
                    :columns="effectiveColumns"
                    row-key="id"
                    :pagination="{ rowsPerPage: 0 }"
                    :loading="loading"
                    hide-pagination
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: subscriptions (minimal). Apps pass
// `loadSubscriptions` + optional `columns` through — default columns show
// tenant/plan/status/period.

export interface SubscriptionRow {
    id: string;
    tenant?: { slug?: string; name?: string };
    tenantSlug?: string;
    plan?: string;
    planId?: string;
    status?: string;
    periodEndsAt?: string | null;
    monthlyNet?: string | number | null;
    [extra: string]: unknown;
}

interface Column {
    name: string;
    label: string;
    field: string | ((r: SubscriptionRow) => unknown);
    align?: 'left' | 'right' | 'center';
    sortable?: boolean;
}

const props = withDefaults(
    defineProps<{
        loadSubscriptions: () => Promise<SubscriptionRow[]>;
        subtitle?: string;
        columns?: readonly Column[];
    }>(),
    {},
);

const msg = useSaMessages('tenants');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();

const rows = ref<SubscriptionRow[]>([]);
const loading = ref(false);

const defaultColumns = computed<Column[]>(() => [
    {
        name: 'tenant',
        label: msg.value.tenant,
        field: (r) => r.tenant?.name ?? r.tenant?.slug ?? r.tenantSlug ?? '—',
        align: 'left',
        sortable: true,
    },
    {
        name: 'plan',
        label: msg.value.plan,
        field: (r) => r.plan ?? r.planId ?? '—',
        align: 'left',
    },
    {
        name: 'status',
        label: common.value.status,
        field: (r) => r.status ?? '—',
        align: 'left',
    },
    {
        name: 'periodEndsAt',
        label: msg.value.subscriptions.columnEndsAt,
        field: (r) => formatDate(r.periodEndsAt) ?? '∞',
        align: 'left',
    },
]);

const effectiveColumns = computed<Column[]>(() =>
    props.columns ? [...props.columns] : defaultColumns.value,
);

async function reload() {
    loading.value = true;
    try {
        rows.value = await props.loadSubscriptions();
    } catch (err) {
        rows.value = [];
        console.warn('[SubscriptionsPage] loadSubscriptions failed:', err);
    } finally {
        loading.value = false;
    }
}

onMounted(reload);

function formatDate(iso: string | null | undefined): string | null {
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

<style scoped>
.sa-subscriptions {
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
}
.sa-subscriptions__head {
    padding: 20px 28px 8px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
}
.sa-subscriptions__title {
    margin: 0;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 22px;
    color: var(--sa-heading, #0f172a);
}
.sa-subscriptions__sub {
    margin: 4px 0 0;
    color: var(--sa-muted-dark, #475569);
    font-size: 13.5px;
}
.sa-subscriptions__body {
    padding: 12px 28px 28px;
}
.sa-subscriptions__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
}
</style>

<template>
    <AdminPage class="sa-subscriptions">
        <AdminHero :title="msg.subscriptions.title" :subtitle="subtitle">
            <template #actions>
                <slot name="head-actions" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminSection class="sa-subscriptions__body">
                <div class="sa-subscriptions__card">
                    <q-table
                        flat
                        :rows="pagedRows"
                        :pagination="{ rowsPerPage: ALL_ROWS }"
                        :columns="effectiveColumns"
                        row-key="id"
                        :loading="loading"
                        hide-pagination
                    />

                    <AdminPaginator
                        storage-key="subscriptions"
                        v-model:page="page"
                        v-model:rows-per-page="rowsPerPage"
                        :total="total"
                    />
                </div>
            </AdminSection>
        </AdminBody>
    </AdminPage>
</template>

<script setup lang="ts">
import { ALL_ROWS, usePagination } from '../vue/use-pagination.js';
import AdminPaginator from '../components/admin-page/AdminPaginator.vue';
import { computed, onMounted, ref } from 'vue';
import AdminBody from '../components/admin-page/AdminBody.vue';
import AdminHero from '../components/admin-page/AdminHero.vue';
import AdminSection from '../components/admin-page/AdminSection.vue';
import AdminPage from '../components/admin-page/AdminPage.vue';
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

const { page, rowsPerPage, total, pagedRows } = usePagination(rows);
</script>

<style scoped>
.sa-subscriptions__card {
    background: #fff;
    border: 1px solid var(--sa-border, var(--sa-border));
    border-radius: 12px;
    overflow: hidden;
}
</style>

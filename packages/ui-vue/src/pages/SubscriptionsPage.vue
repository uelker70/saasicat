<template>
    <AdminPage class="sa-subscriptions">
        <AdminHero :title="msg.subscriptions.title" :subtitle="subtitle">
            <template #actions>
                <slot name="head-actions" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminSection class="sa-subscriptions__body">
                <AdminTable
                    :rows="rows"
                    :columns="effectiveColumns"
                    :loading="loading"
                    storage-key="subscriptions"
                />
            </AdminSection>
        </AdminBody>
    </AdminPage>
</template>

<script setup lang="ts">
import AdminTable from '../ui/data/AdminTable.vue';
import { useResource } from '../vue/resource-registry.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type { subscriptionsResource } from '../client/resources/subscriptions.resource.js';
import { computed, onMounted, ref } from 'vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: subscriptions (minimal). It reads the platform's
// subscriptions resource itself; an app passes only `columns` when the default
// tenant/plan/status/period set is not what it wants.

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
        /**
         * Override the subscriptions resource for this page only — a different
         * host, or one operation wrapped. Layered over the app's own override;
         * see AP3 §3.2.
         */
        resources?: ResourceOverride<(typeof subscriptionsResource)['ops']>;
        subtitle?: string;
        columns?: readonly Column[];
    }>(),
    {},
);

// The data layer, reached by name — no endpoint to pass in.
const subscriptions = useResource('subscriptions', props.resources);

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
        rows.value = await subscriptions.list();
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

<style scoped></style>

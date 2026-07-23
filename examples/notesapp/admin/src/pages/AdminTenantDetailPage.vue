<template>
    <PlatformTenantDetailPage
        :load-detail="loadDetail"
        :back-route="backRoute"
        :manifest="manifest"
        :verbrauch-fields="verbrauchFields"
        :user-columns="userColumns"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import type { QTableColumn } from 'quasar';
import PlatformTenantDetailPage from '@saasicat/ui-vue/pages/TenantDetailPage.vue';
import { loadTenantDetail, type TenantDetailData } from '../services/app-loaders';
import { useManifestStore } from '../stores/manifest';

// Tenant detail (GET /admin/tenants/:slug). The suspend/reactivate card actions
// reuse the same manifest flow as the list page.
const route = useRoute();
const slug = String(route.params.slug);
const backRoute = '/admin/tenants';

function loadDetail(): Promise<TenantDetailData> {
    return loadTenantDetail(slug);
}

const verbrauchFields = [
    { label: 'Notizen', key: 'notes' },
    { label: 'Nutzer', key: 'users' },
];

const userColumns: QTableColumn[] = [
    { name: 'email', label: 'E-Mail', field: 'email', align: 'left' },
    {
        name: 'createdAt',
        label: 'Angelegt',
        field: (row: Record<string, unknown>) => String(row.createdAt ?? '').slice(0, 10),
        align: 'left',
    },
];

const manifestStore = useManifestStore();
const manifest = computed(() => manifestStore.manifest);
</script>

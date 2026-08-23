<template>
    <PlatformTenantDetailPage :options="options" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import PlatformTenantDetailPage from '@saasicat/ui-vue/pages/TenantDetailPage.vue';
import type { TenantDetailPageOptions } from '@saasicat/ui-vue/pages/TenantDetailPage.vue';
import { useManifestStore } from '../stores/manifest';

// Tenant detail. The page takes the slug from the route and reads the platform's
// tenants resource itself; the suspend/reactivate card actions reuse the same
// manifest flow as the list page.
const manifestStore = useManifestStore();

const options = computed<TenantDetailPageOptions>(() => ({
    backRoute: '/admin/tenants',
    manifest: manifestStore.manifest,
    verbrauchFields: [
        { label: 'Notes', key: 'notes' },
        { label: 'Users', key: 'users' },
    ],
    userColumns: [
        { name: 'email', label: 'E-Mail', field: 'email', align: 'left' },
        {
            name: 'createdAt',
            label: 'Angelegt',
            field: (row: Record<string, unknown>) => String(row.createdAt ?? '').slice(0, 10),
            align: 'left',
        },
    ] satisfies QTableColumn[],
}));
</script>

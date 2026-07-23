<template>
    <PlatformTenantsPage
        :endpoint="endpoint"
        :http="http"
        :manifest="manifest"
        :subtitle="subtitle"
        :plan-options="planOptions"
        :usage-fields="usageFields"
        :actions="actions"
        :action-notify="notify"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useQuasar } from 'quasar';
import PlatformTenantsPage from '@saasicat/ui-vue/pages/TenantsPage.vue';
import { platformHttp } from '../services/http';
import { TENANTS_ENDPOINT } from '../services/app-loaders';
import { useManifestStore } from '../stores/manifest';

// Tenants list. Rows come from GET /admin/tenants (useTenants inside the page);
// the suspend/reactivate row actions are the platform-core spine actions,
// dispatched through the `actions` map in main.ts. A custom "detail" link opens
// the /admin/tenants/:slug page.
const http = platformHttp;
const endpoint = TENANTS_ENDPOINT;
const subtitle = 'Mandanten mit Plan, Status und Notiz-Nutzung.';
const planOptions = ['STARTER', 'PRO'] as const;
const usageFields = [{ icon: 'sticky_note_2', field: 'notes' }];

const actions = [
    {
        id: 'detail',
        label: 'Details',
        icon: 'open_in_new',
        tone: 'primary' as const,
        to: (row: Record<string, unknown>): string => `/admin/tenants/${String(row.slug)}`,
    },
];

const manifestStore = useManifestStore();
const manifest = computed(() => manifestStore.manifest);

const $q = useQuasar();
function notify(kind: 'positive' | 'negative', message: string): void {
    $q.notify({ type: kind, message, position: 'top' });
}
</script>

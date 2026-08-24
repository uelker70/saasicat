<template>
    <PlatformTenantsPage :options="options" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import PlatformTenantsPage from '@saasicat/ui-vue/pages/TenantsPage.vue';
import type { TenantsPageOptions } from '@saasicat/ui-vue/pages/TenantsPage.vue';
import { useManifestStore } from '../stores/manifest';

// Tenants list. Rows come from the platform's tenants resource, and the
// suspend/reactivate row actions are the platform-core spine actions dispatched
// through the `actions` map in main.ts. Toasts go through the notify port the
// shell installs, so there is nothing to wire here.
const manifestStore = useManifestStore();

const options = computed<TenantsPageOptions>(() => ({
    manifest: manifestStore.manifest,
    subtitle: 'Tenants with their plan, status and note usage.',
    planOptions: ['STARTER', 'PRO'],
    usageFields: [{ icon: 'sticky_note_2', field: 'notes' }],
    // A custom link into the detail page, beside the manifest's own actions.
    actions: [
        {
            id: 'detail',
            label: 'Details',
            icon: 'open_in_new',
            tone: 'primary' as const,
            to: (row: Record<string, unknown>): string => `/admin/tenants/${String(row.slug)}`,
        },
    ],
}));
</script>

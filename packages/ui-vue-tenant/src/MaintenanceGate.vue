<template>
    <MaintenanceNotice
        v-if="status.state === 'locked'"
        :status="status"
        :refused="maintenance.refused.value"
    />
    <template v-else>
        <MaintenanceBanner v-if="status.state === 'announced'" :status="status" />
        <slot />
    </template>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMaintenanceStatus, type HttpClient } from '@saasicat/ui-vue';

import MaintenanceBanner from './maintenance/MaintenanceBanner.vue';
import MaintenanceNotice from './maintenance/MaintenanceNotice.vue';
import './ui/tenant-ui.css';

// Wraps the application. With nothing announced it renders the application and
// nothing else; with a window ahead it puts the announcement above it — the
// sign-in page included, which is why it wraps the whole of the application
// rather than the pages behind the sign-in (`SC-OPS-012`); while the lock
// holds it renders the maintenance page instead, and the application again
// once the lock is lifted, on the screen the tenant was on (`SC-UI-026`).
//
// Where the application's HTTP client hands each response to
// `reportMaintenanceRefusal`, the page appears the moment a request is
// refused rather than at the next poll, and says the request was not carried
// out.

const props = defineProps<{
    http?: HttpClient;
    /** Where the platform's routes are mounted, such as `/api`. */
    apiBase?: string;
}>();

const maintenance = useMaintenanceStatus({ http: props.http, apiBase: props.apiBase });
const status = computed(() => maintenance.status.value);
</script>

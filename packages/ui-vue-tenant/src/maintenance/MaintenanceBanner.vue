<template>
    <div class="sp-maintenance-banner" role="status">
        <p class="sp-maintenance-banner__text">{{ announced }}</p>
        <p v-if="status.message" class="sp-maintenance-banner__message">{{ status.message }}</p>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MaintenanceStatusView } from '@saasicat/core';
import { formatMessage, useSuperAdminI18n } from '@saasicat/ui-vue';

import { useTenantI18n } from '../tenant-i18n.js';
import { maintenanceMoment } from './maintenance-moment.js';

// A window announced ahead, above the application and on its sign-in page
// (`SC-OPS-012`). The operator's message is shown as written.

const props = defineProps<{
    status: Extract<MaintenanceStatusView, { state: 'announced' }>;
}>();

const i18n = useTenantI18n();
const { intlLocale } = useSuperAdminI18n();

const announced = computed(() =>
    formatMessage(i18n.value.maintenanceAnnounced, {
        start: maintenanceMoment(props.status.startsAt, intlLocale.value),
        end: maintenanceMoment(props.status.endsAt, intlLocale.value),
    }),
);
</script>

<style scoped>
.sp-maintenance-banner {
    padding: var(--sa-space-2) var(--sa-space-4);
    border-bottom: 1px solid var(--sa-color-warning-border);
    background: var(--sa-color-warning-surface);
    color: var(--sa-color-warning-fg);
    font-size: var(--sa-text-sm);
}
.sp-maintenance-banner__text,
.sp-maintenance-banner__message {
    margin: 0;
}
.sp-maintenance-banner__message {
    margin-top: var(--sa-space-1);
}
</style>

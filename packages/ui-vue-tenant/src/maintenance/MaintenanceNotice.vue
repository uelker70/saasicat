<template>
    <main class="sp-maintenance-notice">
        <TenantCard>
            <section class="sp-maintenance-notice__body" role="status" aria-live="polite">
                <h1 class="sp-maintenance-notice__title">{{ i18n.maintenanceTitle }}</h1>
                <p>{{ state }}</p>
                <p v-if="status.overrun">{{ i18n.maintenanceOverrun }}</p>
                <p v-if="status.message" class="sp-maintenance-notice__message">
                    {{ status.message }}
                </p>
                <p v-if="refused" class="sp-maintenance-notice__refused" role="alert">
                    {{ i18n.maintenanceRefused }}
                </p>
                <p class="sp-maintenance-notice__resumes">{{ i18n.maintenanceResumes }}</p>
            </section>
        </TenantCard>
    </main>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { MaintenanceStatusView } from '@saasicat/core';
import { formatMessage, useSuperAdminI18n } from '@saasicat/ui-vue';

import { useTenantI18n } from '../tenant-i18n.js';
import TenantCard from '../ui/TenantCard.vue';
import { maintenanceMoment } from './maintenance-moment.js';

// The one page a locked-out tenant sees, instead of each action failing on its
// own (`SC-UI-026`): the expected end — or that it is taking longer — the
// operator's message, and, where a request was refused on its way, that what
// the tenant was doing was not carried out.

const props = defineProps<{
    status: Extract<MaintenanceStatusView, { state: 'locked' }>;
    refused: boolean;
}>();

const i18n = useTenantI18n();
const { intlLocale } = useSuperAdminI18n();

const state = computed(() =>
    props.status.endsAt && !props.status.overrun
        ? formatMessage(i18n.value.maintenanceUntil, {
              end: maintenanceMoment(props.status.endsAt, intlLocale.value),
          })
        : i18n.value.maintenanceNoEnd,
);
</script>

<style scoped>
.sp-maintenance-notice {
    display: grid;
    place-items: center;
    min-height: 60vh;
    padding: var(--sa-space-6) var(--sa-space-4);
}
.sp-maintenance-notice__body {
    max-width: 36rem;
    padding: var(--sa-space-6);
}
.sp-maintenance-notice__title {
    margin: 0 0 var(--sa-space-3);
    color: var(--sa-color-fg-heading);
    font-size: var(--sa-text-2xl);
}
.sp-maintenance-notice__message {
    color: var(--sa-color-fg-secondary);
    white-space: pre-line;
}
.sp-maintenance-notice__refused {
    color: var(--sa-color-negative-fg);
}
.sp-maintenance-notice__resumes {
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-sm);
}
</style>

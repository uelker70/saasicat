<template>
    <AdminSection
        v-if="error || wording"
        :title="msg.detail.deletion.title"
        class="sa-tenant-deletion q-mb-md"
    >
        <template v-if="recordLink && !error" #actions>
            <q-btn
                flat
                no-caps
                icon="history"
                :label="msg.detail.deletion.openRecord"
                :to="recordLink"
            />
        </template>
        <AdminErrorBanner :error="error" :title="msg.detail.deletion.loadFailed" :retry="retry" />
        <div v-if="!error && wording && deletion" class="sa-tenant-deletion__state">
            <AdminStatusPill
                :label="wording.label"
                :tone="TENANT_DELETION_STATE_TONE[deletion.status.kind]"
                class="sa-tenant-deletion__pill"
            />
            <p v-for="line in wording.lines" :key="line" class="sa-tenant-deletion__line">
                {{ line }}
            </p>
            <ul v-if="wording.reasons.length > 0" class="sa-tenant-deletion__reasons">
                <li v-for="reason in wording.reasons" :key="reason">{{ reason }}</li>
            </ul>
        </div>
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AdminTenantDeletion } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatDay, formatMoment } from '../../client/i18n/format.js';
import { tenantDeletionWording } from '../../client/tenant-deletion-lines.js';
import AdminStatusPill from '../../ui/data/AdminStatusPill.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import { TENANT_DELETION_STATE_TONE } from '../../vue/use-tenant-deletion.js';

// Where the tenant's deletion stands, as the operator reads it on the tenant's
// page (`SC-ADM-058`): its state, what that state says, and every reason that
// holds it — or, before its day, would. Absent where no deletion is to come.
// Once the deletion has begun, what each store counted and erased is in the
// subscriber's record, and the section leads there. Pure presentation: the
// state is decided on the server and worded in `client/tenant-deletion-lines`.
const props = defineProps<{
    deletion: AdminTenantDeletion | null;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** The subscriber the deletion's record is kept with; `null` where none is known. */
    subscriberId: string | null;
    /** Where a subscriber's record answers. */
    recordRoute: (subscriberId: string) => RouteLocationRaw;
}>();

const msg = useSaMessages('tenants');
const { intlLocale } = useSuperAdminI18n();

const wording = computed(() =>
    props.deletion
        ? tenantDeletionWording(props.deletion, msg.value.detail.deletion, {
              day: (day) => formatDay(day, intlLocale.value),
              moment: (iso) => formatMoment(iso, intlLocale.value),
          })
        : null,
);

const recordLink = computed(() =>
    props.deletion?.record && props.subscriberId ? props.recordRoute(props.subscriberId) : null,
);
</script>

<style scoped>
.sa-tenant-deletion__state {
    display: grid;
    gap: var(--sa-space-2);
    justify-items: start;
}
.sa-tenant-deletion__line {
    margin: 0;
}
.sa-tenant-deletion__reasons {
    margin: 0;
    padding-inline-start: var(--sa-space-5);
    display: grid;
    gap: var(--sa-space-1);
}
</style>

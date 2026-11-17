<template>
    <AdminSection
        v-if="error || deletion"
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
        <TenantDeletionStatus v-if="!error && deletion" :deletion="deletion" />
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AdminTenantDeletion } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import TenantDeletionStatus from './TenantDeletionStatus.vue';

// Where the tenant's deletion stands, as the operator reads it on the tenant's
// page (`SC-ADM-058`). Absent where no deletion is to come. Once the deletion
// has begun, what each store counted and erased is in the subscriber's
// record, and the section leads there.
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

const recordLink = computed(() =>
    props.deletion?.record && props.subscriberId ? props.recordRoute(props.subscriberId) : null,
);
</script>

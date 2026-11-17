<template>
    <div class="sa-tenant-deletion-status">
        <AdminStatusPill
            :label="wording.label"
            :tone="TENANT_DELETION_STATE_TONE[deletion.status.kind]"
        />
        <p v-for="line in wording.lines" :key="line" class="sa-tenant-deletion-status__line">
            {{ line }}
        </p>
        <ul v-if="wording.reasons.length > 0" class="sa-tenant-deletion-status__reasons">
            <li v-for="reason in wording.reasons" :key="reason">{{ reason }}</li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AdminTenantDeletion } from '@saasicat/core';

import { tenantDeletionWording } from '../../client/tenant-deletion-lines.js';
import AdminStatusPill from '../../ui/data/AdminStatusPill.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import { TENANT_DELETION_STATE_TONE } from '../../vue/use-tenant-deletion.js';
import { useTenantDeletionWriters } from '../../vue/use-tenant-deletion-writers.js';

// Where a tenant's deletion stands, in words, the same on the tenant's page
// and in its subscriber's record (`SC-ADM-058`): its state, what that state
// says, and every reason that holds it — or, before its day, would. Pure
// presentation: the state is decided on the server and worded in
// `client/tenant-deletion-lines`.
const props = defineProps<{ deletion: AdminTenantDeletion }>();

const msg = useSaMessages('tenants');
const writers = useTenantDeletionWriters();

const wording = computed(() =>
    tenantDeletionWording(props.deletion, msg.value.detail.deletion, writers.value),
);
</script>

<style scoped>
.sa-tenant-deletion-status {
    display: grid;
    gap: var(--sa-space-2);
    justify-items: start;
}
.sa-tenant-deletion-status__line {
    margin: 0;
}
.sa-tenant-deletion-status__reasons {
    margin: 0;
    padding-inline-start: var(--sa-space-5);
    display: grid;
    gap: var(--sa-space-1);
}
</style>

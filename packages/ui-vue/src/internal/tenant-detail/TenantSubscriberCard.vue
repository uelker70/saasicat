<template>
    <AdminSection :title="msg.subscriber.title" :subtitle="holderLine" class="q-mb-md">
        <template v-if="standing?.subscriber" #actions>
            <q-btn
                flat
                no-caps
                icon="contact_page"
                :label="msg.record.open"
                :to="recordRoute(standing.subscriber.id)"
            />
        </template>
        <AdminErrorBanner :error="error" :title="msg.subscriber.loadFailed" :retry="retry" />
        <p v-if="!error && pending && !standing" class="sa-tenant-subscriber-card__note">
            {{ common.loading }}
        </p>
        <template v-else-if="!error && standing">
            <p v-if="!standing.subscriber" class="sa-tenant-subscriber-card__note">
                {{ msg.subscriber.none }}
            </p>
            <SubscriberHeldBack v-else :readiness="standing.readiness" />
        </template>
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AdminTenantSubscriber } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatMessage } from '../../client/i18n/format.js';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import SubscriberHeldBack from '../subscriber-record/SubscriberHeldBack.vue';

// Whom the tenant's contracts are concluded with, named by customer number and
// legal name, what holds its next contract back, and the way into its record —
// where its master data, account, invoices and contracts are, and where they
// stay once the tenant is gone (`SC-ADM-021`).
const props = defineProps<{
    standing: AdminTenantSubscriber | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** Where a subscriber's record answers. */
    recordRoute: (subscriberId: string) => RouteLocationRaw;
}>();

const msg = useSaMessages('subscribers');
const common = useSaMessages('common');

const holderLine = computed(() => {
    const subscriber = props.standing?.subscriber;
    if (!subscriber) return undefined;
    return formatMessage(msg.value.subscriber.holder, {
        customerNumber: subscriber.customerNumber,
        legalName: subscriber.legalName,
    });
});
</script>

<style scoped>
.sa-tenant-subscriber-card__note {
    color: var(--sa-color-fg-muted);
    margin: 0;
}
</style>

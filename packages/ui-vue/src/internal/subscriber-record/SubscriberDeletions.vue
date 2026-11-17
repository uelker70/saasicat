<template>
    <AdminSection :title="m.title" :subtitle="m.subtitle" class="sa-subscriber-deletions q-mb-md">
        <AdminErrorBanner :error="error" :title="m.loadFailed" :retry="retry" />
        <template v-if="!error">
            <p v-if="pending && deletions.length === 0" class="sa-subscriber-deletions__note">
                {{ common.loading }}
            </p>
            <AdminEmptyState v-else-if="deletions.length === 0" :title="m.none" size="inline" />
            <ul v-else class="sa-subscriber-deletions__list">
                <li
                    v-for="entry in entries"
                    :key="entry.key"
                    class="sa-subscriber-deletions__entry"
                >
                    <h3 class="sa-subscriber-deletions__name">
                        <router-link
                            v-if="entry.to"
                            :to="entry.to"
                            :aria-label="entry.openLabel"
                            class="sa-link"
                        >
                            {{ entry.name }}
                        </router-link>
                        <template v-else>{{ entry.name }}</template>
                    </h3>
                    <TenantDeletionStatus :deletion="entry.deletion" />
                    <SubscriberDeletionRecord
                        v-if="entry.deletion.record"
                        :record="entry.deletion.record"
                    />
                </li>
            </ul>
        </template>
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AdminSubscriberTenant, AdminTenantDeletion } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatMessage } from '../../client/i18n/format.js';
import AdminEmptyState from '../../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import TenantDeletionStatus from '../tenant-detail/TenantDeletionStatus.vue';
import SubscriberDeletionRecord from './SubscriberDeletionRecord.vue';

// The deletion of each of the subscriber's tenants, in the order the server
// gives them (`SC-ADM-058`), with what is recorded of a begun one — also of a
// tenant the application no longer has, which is named by its id as the
// record's list of tenants names it (`SC-ADM-021`).
const props = defineProps<{
    deletions: readonly AdminTenantDeletion[];
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** The subscriber's tenants, as its record lists them, to name each deletion's tenant. */
    tenants: readonly AdminSubscriberTenant[];
    /** Where a tenant's page answers. */
    tenantRoute: (slug: string) => RouteLocationRaw;
}>();

const msg = useSaMessages('subscribers');
const common = useSaMessages('common');

const m = computed(() => msg.value.record.deletions);

const entries = computed(() =>
    props.deletions.map((deletion) => {
        const tenant = props.tenants.find((each) => each.tenantId === deletion.tenantId);
        const name = tenant?.name ?? tenant?.slug ?? deletion.tenantId;
        return {
            key: `${deletion.tenantId}:${deletion.record?.startedAt ?? deletion.status.kind}`,
            name,
            to: tenant?.known && tenant.slug ? props.tenantRoute(tenant.slug) : null,
            openLabel: formatMessage(msg.value.record.tenants.open, { name }),
            deletion,
        };
    }),
);
</script>

<style scoped>
/* One column no wider than the section: an `auto` track grows to the widest
 * content inside it, and a record's tables are wider than a phone. Held to the
 * section, a table scrolls in its own frame instead of pushing the page. */
.sa-subscriber-deletions__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sa-space-5);
}
.sa-subscriber-deletions__entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sa-space-3);
}
.sa-subscriber-deletions__name {
    margin: 0;
    font-size: var(--sa-text-md);
    font-weight: var(--sa-weight-semibold);
}
.sa-subscriber-deletions__note {
    color: var(--sa-color-fg-muted);
    margin: 0;
}
</style>

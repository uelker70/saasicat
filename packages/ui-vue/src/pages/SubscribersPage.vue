<template>
    <AdminPage class="sa-subscribers">
        <AdminHero :title="msg.list.title" :subtitle="msg.list.subtitle">
            <template #actions>
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminErrorBanner :error="error" :title="msg.list.loadFailed" :retry="reload" />

            <AdminSection>
                <AdminFilters class="q-mb-lg">
                    <q-input
                        v-model="query"
                        outlined
                        dense
                        clearable
                        :label="msg.list.searchPlaceholder"
                        :maxlength="SUBSCRIBER_SEARCH_MAX_LENGTH"
                        debounce="250"
                    >
                        <template #prepend><q-icon name="search" size="18px" /></template>
                    </q-input>
                    <q-toggle v-model="withoutLiveTenant" :label="msg.list.withoutLiveTenant" />
                </AdminFilters>

                <AdminEmptyState
                    v-if="!loading && !error && tableRows.length === 0"
                    :title="msg.list.empty"
                    size="inline"
                />
                <AdminTable
                    v-else
                    :rows="tableRows"
                    :columns="columns"
                    row-key="id"
                    :loading="loading"
                    storage-key="subscribers"
                >
                    <template #body-cell-customerNumber="{ row }">
                        <q-td>
                            <router-link
                                :to="recordRoute(row.id)"
                                :aria-label="row.openLabel"
                                class="sa-link"
                            >
                                {{ row.customerNumber }}
                            </router-link>
                            <AdminStatusPill
                                v-if="row.joinedInto"
                                class="q-ml-sm"
                                :label="row.joinedInto"
                                tone="muted"
                            />
                        </q-td>
                    </template>
                </AdminTable>
                <div v-if="hasMore" class="q-mt-sm">
                    <q-btn flat no-caps :label="msg.list.more" :loading="loading" @click="more" />
                </div>
            </AdminSection>
        </AdminBody>
    </AdminPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import { SUBSCRIBER_SEARCH_MAX_LENGTH, type AdminSubscriberRow } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatMessage } from '../client/i18n/format.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import AdminStatusPill from '../ui/data/AdminStatusPill.vue';
import AdminTable from '../ui/data/AdminTable.vue';
import AdminEmptyState from '../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminFilters from '../ui/page/AdminFilters.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import { type ResourceOverride, useResource } from '../vue/resource-registry.js';
import { useSubscribers } from '../vue/use-subscribers.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

// Platform standard page: every subscriber, with the way into its record.
//
// What it answers is the support call that starts with a name or a customer
// number rather than a tenant's slug — and the one about a customer whose
// tenant is gone, whose credit is still to be paid out or whose invoice has to
// be cancelled: its record is found here, and only here (`SC-ADM-036`).

const props = defineProps<{
    /** Override the resource for this page only; see AP3 §3.2. */
    resources?: {
        subscribers?: ResourceOverride<(typeof subscribersResource)['ops']>;
    };
}>();

const msg = useSaMessages('subscribers');
const { query, withoutLiveTenant, rows, loading, error, hasMore, reload, more } = useSubscribers(
    useResource('subscribers', props.resources?.subscribers),
);

/** Where a subscriber's record answers — beside this page, under the same base. */
function recordRoute(subscriberId: string): RouteLocationRaw {
    return `/admin/subscribers/${encodeURIComponent(subscriberId)}`;
}

/** The tenant a row names: its live one by name, or why it names none. */
function tenantOf(row: AdminSubscriberRow): string {
    const tenant = row.liveTenant;
    if (!tenant) return msg.value.list.noTenant;
    return tenant.name ?? tenant.slug ?? msg.value.list.unknownTenant;
}

const tableRows = computed(() =>
    rows.value.map((row) => ({
        id: row.id,
        customerNumber: row.customerNumber,
        openLabel: formatMessage(msg.value.list.open, { customerNumber: row.customerNumber }),
        legalName: row.legalName,
        vatId: row.vatId ?? '',
        place: [row.city, row.country].filter(Boolean).join(', '),
        tenant: tenantOf(row),
        joinedInto: row.joinedInto
            ? formatMessage(msg.value.join.listMarker, row.joinedInto)
            : null,
    })),
);

const columns = computed<QTableColumn[]>(() => {
    const m = msg.value.list;
    return [
        {
            name: 'customerNumber',
            label: m.columnCustomerNumber,
            field: 'customerNumber',
            align: 'left',
        },
        { name: 'legalName', label: m.columnLegalName, field: 'legalName', align: 'left' },
        { name: 'vatId', label: m.columnVatId, field: 'vatId', align: 'left' },
        { name: 'place', label: m.columnPlace, field: 'place', align: 'left' },
        { name: 'tenant', label: m.columnTenant, field: 'tenant', align: 'left' },
    ];
});
</script>

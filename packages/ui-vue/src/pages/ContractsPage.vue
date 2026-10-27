<template>
    <AdminPage class="sa-contracts">
        <AdminHero :title="msg.title" :subtitle="msg.subtitle">
            <template #actions>
                <AdminRefreshBtn :loading="list.loading.value" @refresh="list.reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminFilters class="q-mb-lg">
                <q-select
                    v-model="register.state.value"
                    outlined
                    dense
                    emit-value
                    map-options
                    :options="stateOptions"
                    :label="msg.state"
                />
                <q-input
                    v-model="register.day.value"
                    outlined
                    dense
                    clearable
                    stack-label
                    type="date"
                    :label="msg.day"
                    :hint="msg.dayHint"
                />
            </AdminFilters>

            <AdminSection :title="sectionTitle">
                <AdminErrorBanner
                    :error="list.error.value"
                    :title="msg.loadFailed"
                    :retry="list.reload"
                />
                <AdminEmptyState
                    v-if="!list.loading.value && !list.error.value && rows.length === 0"
                    :title="msg.empty"
                    size="inline"
                />
                <AdminTable
                    v-else-if="!list.error.value"
                    :rows="rows"
                    :columns="columns"
                    row-key="id"
                    :loading="list.loading.value"
                    storage-key="contracts"
                >
                    <template #body-cell-subscriber="{ row }">
                        <q-td>
                            <router-link
                                :to="row.contractRoute"
                                :aria-label="row.openLabel"
                                class="sa-link"
                            >
                                {{ row.subscriber }}
                            </router-link>
                        </q-td>
                    </template>
                    <template #body-cell-standing="{ row }">
                        <q-td>
                            <AdminStatusPill
                                :label="row.standing"
                                :tone="row.tone"
                                variant="outline"
                                size="sm"
                            />
                        </q-td>
                    </template>
                </AdminTable>
                <div v-if="list.hasMore.value" class="q-mt-sm">
                    <q-btn
                        flat
                        no-caps
                        :label="msg.more"
                        :loading="list.loading.value"
                        @click="list.more"
                    />
                </div>
            </AdminSection>
        </AdminBody>
    </AdminPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import { CONTRACT_REGISTER_STATES, type AdminRegisterContract } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatCurrency } from '../client/i18n/currency.js';
import { formatMessage } from '../client/i18n/format.js';
import type { contractsResource } from '../client/resources/contracts.resource.js';
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
import { useStandardPageRoute } from '../vue/standard-page-routes.js';
import { CONTRACT_STANDING_TONE, useContractRegister } from '../vue/use-contract-register.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: every contract of the installation, a former
// subscriber's and a deleted tenant's included (`SC-ADM-045`), narrowed to
// where they stand on a day; each opens in its subscriber's record with the
// contract open.

const props = defineProps<{
    /** Override the resource for this page only; see AP3 §3.2. */
    resources?: ResourceOverride<(typeof contractsResource)['ops']>;
}>();

const msg = useSaMessages('contractRegister');
const subscriberTexts = useSaMessages('subscribers');
const common = useSaMessages('common');
const { locale } = useSuperAdminI18n();
const register = useContractRegister(useResource('contracts', props.resources));
const list = register.contracts;
const standardPageRoute = useStandardPageRoute();

const stateOptions = computed(() =>
    CONTRACT_REGISTER_STATES.map((state) => ({ value: state, label: msg.value.states[state] })),
);

const sectionTitle = computed(() =>
    formatMessage(msg.value.listTitle, { day: register.readOn.value ?? '—' }),
);

/** The subscriber's record with `contractId` open — beside its list, wherever the shell put that. */
function contractRoute(subscriberId: string, contractId: string): RouteLocationRaw {
    return {
        path: `${standardPageRoute('subscribers')}/${encodeURIComponent(subscriberId)}`,
        query: { contract: contractId },
    };
}

function tenantOf({ tenant }: AdminRegisterContract): string {
    const m = subscriberTexts.value.contracts;
    if (!tenant.known) return formatMessage(m.tenantUnknown, { tenantId: tenant.id });
    const name = tenant.name ?? tenant.slug ?? tenant.id;
    return tenant.deletedAt ? formatMessage(msg.value.tenantDeleted, { name }) : name;
}

function periodOf(contract: AdminRegisterContract): string {
    const m = subscriberTexts.value.contracts;
    if (contract.standing === 'never-in-force') return m.neverInForce;
    if (contract.lastDay === null) return formatMessage(m.running, { from: contract.firstDay });
    return formatMessage(m.period, { from: contract.firstDay, until: contract.lastDay });
}

const rows = computed(() =>
    list.rows.value.map((contract) => ({
        id: contract.id,
        subscriber: `${contract.subscriber.customerNumber} · ${contract.subscriber.legalName}`,
        contractRoute: contractRoute(contract.subscriber.id, contract.id),
        openLabel: formatMessage(msg.value.openContract, {
            customerNumber: contract.subscriber.customerNumber,
        }),
        tenant: tenantOf(contract),
        plan: [
            contract.plan?.title ?? msg.value.noPlan,
            ...contract.bundles.map((b) => b.title),
        ].join(' + '),
        period: periodOf(contract),
        standing: msg.value.states[contract.standing],
        tone: CONTRACT_STANDING_TONE[contract.standing],
        price: formatMessage(subscriberTexts.value.contracts.perPeriod, {
            amount: formatCurrency(contract.totalGross, locale.value, contract.currency),
            cycle: common.value[contract.billingCycle],
        }),
    })),
);

const columns = computed<QTableColumn[]>(() => {
    const m = msg.value;
    return [
        { name: 'subscriber', label: m.columnSubscriber, field: 'subscriber', align: 'left' },
        { name: 'tenant', label: m.columnTenant, field: 'tenant', align: 'left' },
        { name: 'plan', label: m.columnPlan, field: 'plan', align: 'left' },
        { name: 'period', label: m.columnPeriod, field: 'period', align: 'left' },
        { name: 'standing', label: m.columnStanding, field: 'standing', align: 'left' },
        { name: 'price', label: m.columnPrice, field: 'price', align: 'right' },
    ];
});
</script>

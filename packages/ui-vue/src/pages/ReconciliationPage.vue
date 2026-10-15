<template>
    <AdminPage class="sa-reconciliation">
        <AdminHero :title="msg.title" :subtitle="msg.subtitle">
            <template #actions>
                <q-btn-toggle
                    v-model="state"
                    no-caps
                    unelevated
                    :options="[
                        { label: msg.open, value: 'open' },
                        { label: msg.closed, value: 'closed' },
                    ]"
                />
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminErrorBanner :error="error" :title="msg.loadFailed" :retry="reload" />

            <AdminSection>
                <AdminEmptyState
                    v-if="!loading && !error && tableRows.length === 0"
                    :title="state === 'open' ? msg.emptyOpen : msg.emptyClosed"
                    size="inline"
                />
                <AdminTable
                    v-else
                    :rows="tableRows"
                    :columns="columns"
                    row-key="id"
                    :loading="loading"
                    storage-key="reconciliation"
                >
                    <template v-if="canClose && state === 'open'" #row-actions="{ row }">
                        <AdminRowActions
                            :actions="[{ key: 'close', label: msg.close, icon: 'task_alt' }]"
                            @action="openClose(row.id)"
                        />
                    </template>
                </AdminTable>
                <div v-if="hasMore" class="q-mt-sm">
                    <q-btn flat no-caps :label="msg.more" :loading="loading" @click="more" />
                </div>
            </AdminSection>
        </AdminBody>

        <ReconciliationCloseDialog v-model="closeOpen" :row="closeRow" :close="close" />

        <MfaPromptDialog
            :model-value="mfa.show.value"
            :description="mfa.description.value"
            :error="mfa.error.value"
            @update:model-value="mfa.onVisibility"
            @confirm="mfa.onConfirm"
        />
    </AdminPage>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { QTableColumn } from 'quasar';
import { RECONCILIATION_CLOSE_CAPABILITY, type AdminReconciliationCase } from '@saasicat/core';

import { formatCurrency } from '../client/i18n/currency.js';
import { formatMessage, formatMoment } from '../client/i18n/format.js';
import type { reconciliationResource } from '../client/resources/reconciliation.resource.js';
import ReconciliationCloseDialog from '../features/reconciliation/ReconciliationCloseDialog.vue';
import AdminRowActions from '../ui/data/AdminRowActions.vue';
import AdminTable from '../ui/data/AdminTable.vue';
import AdminEmptyState from '../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import { type ResourceOverride, useResource } from '../vue/resource-registry.js';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { useReconciliation } from '../vue/use-reconciliation.js';
import { useSuperAdminManifest } from '../vue/use-super-admin-context.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: what the gateway reported and nothing matched.
//
// What it answers is the operator's question after the gateway moved money
// SaaSiCat could not match to a credit — a goodwill refund in the Dashboard, a
// chargeback of a payment whose surplus was already refunded: what is open,
// for whom, about which payment, and what was done about each? Closing a case
// declares it reconciled for good, so it asks for a note and the second
// factor (`SC-ADM-033`).

const props = defineProps<{
    /** Override the resource for this page only; see AP3 §3.2. */
    resources?: {
        reconciliation?: ResourceOverride<(typeof reconciliationResource)['ops']>;
    };
}>();

const msg = useSaMessages('reconciliation');
const { intlLocale, locale } = useSuperAdminI18n();
const mfa = useMfaPrompt();
const manifest = useSuperAdminManifest();
const { state, rows, loading, error, hasMore, reload, more, close } = useReconciliation(
    useResource('reconciliation', props.resources?.reconciliation),
    mfa,
);
const canClose = computed(() => manifest?.capabilities?.[RECONCILIATION_CLOSE_CAPABILITY] === true);

const closeOpen = ref(false);
const closeRow = ref<AdminReconciliationCase | null>(null);

function openClose(id: string): void {
    closeRow.value = rows.value.find((row) => row.id === id) ?? null;
    closeOpen.value = closeRow.value !== null;
}

const tableRows = computed(() =>
    rows.value.map((row) => ({
        id: row.id,
        recordedAt: formatMoment(row.recordedAt, intlLocale.value),
        kind: msg.value.kinds[row.kind],
        subscriber: `${row.subscriber.legalName} (${row.subscriber.customerNumber})`,
        payment: formatMessage(msg.value.payment, {
            paymentRef: row.payment.ref,
            invoiceNumber: row.payment.invoiceNumber ?? msg.value.unknownInvoice,
        }),
        reference: row.reference,
        amount: formatCurrency(row.amount, locale.value, row.currency),
        closedAt: row.closedAt ? formatMoment(row.closedAt, intlLocale.value) : '',
        note: row.closedAt
            ? `${row.note ?? ''}${row.closedBy === null ? ` (${msg.value.closedBySaaSiCat})` : ''}`
            : '',
    })),
);

const columns = computed<QTableColumn[]>(() => {
    const c = msg.value.columns;
    const shown: QTableColumn[] = [
        { name: 'recordedAt', label: c.recordedAt, field: 'recordedAt', align: 'left' },
        { name: 'kind', label: c.kind, field: 'kind', align: 'left' },
        { name: 'subscriber', label: c.subscriber, field: 'subscriber', align: 'left' },
        { name: 'payment', label: c.payment, field: 'payment', align: 'left' },
        { name: 'reference', label: c.reference, field: 'reference', align: 'left' },
        { name: 'amount', label: c.amount, field: 'amount', align: 'right' },
    ];
    if (state.value === 'closed') {
        shown.push(
            { name: 'closedAt', label: c.closedAt, field: 'closedAt', align: 'left' },
            { name: 'note', label: c.note, field: 'note', align: 'left' },
        );
    }
    return shown;
});
</script>

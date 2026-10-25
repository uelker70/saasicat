<template>
    <AdminSection :title="msg.contracts.title" :subtitle="msg.contracts.subtitle" class="q-mb-md">
        <AdminErrorBanner :error="error" :title="msg.contracts.loadFailed" :retry="retry" />
        <AdminTable
            v-if="!error"
            :rows="rows"
            :columns="columns"
            row-key="id"
            :loading="pending"
            :empty-text="msg.contracts.empty"
            storage-key="subscriber-contracts"
        >
            <template #body-cell-confirmation="cell">
                <q-td :props="cell">
                    <AdminStatusPill
                        :label="cell.row.confirmation"
                        :tone="cell.row.tone"
                        variant="outline"
                        size="sm"
                    />
                </q-td>
            </template>
            <template #row-actions="{ row }">
                <q-btn
                    v-if="row.archived"
                    flat
                    dense
                    no-caps
                    :label="msg.contracts.download"
                    :aria-label="
                        formatMessage(msg.contracts.downloadConfirmation, { date: row.concluded })
                    "
                    :loading="downloads.downloading.value === row.id"
                    :disable="downloads.downloading.value !== null"
                    @click="downloads.download(row.id)"
                />
            </template>
        </AdminTable>
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import type { AdminSubscriberContract, AdminSubscriberContracts } from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminStatusPill from '../../ui/data/AdminStatusPill.vue';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import type { FileDownload } from '../../vue/use-file-download.js';
import { CONFIRMATION_STATE_TONE } from '../../vue/use-subscriber-contracts.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// The tenant's contracts, the newest first, each with what it records — its
// start, rhythm, price, terms and notice period — and where its confirmation
// stands, with the confirmation's download once it is archived (`SC-AUD-016`).
const props = defineProps<{
    contracts: AdminSubscriberContracts | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** The page's own date format, so one page shows one. */
    formatDate: (value: string | null | undefined) => string;
    /** The confirmation's download, as the page's composable runs it. */
    downloads: FileDownload;
}>();

const msg = useSaMessages('subscribers');
const common = useSaMessages('common');
const { locale } = useSuperAdminI18n();

const rows = computed(() =>
    (props.contracts?.contracts ?? []).map((contract) => ({
        id: contract.id,
        concluded: props.formatDate(contract.concludedAt),
        start: props.formatDate(contract.effectiveFrom),
        status: msg.value.contracts.statuses[contract.status],
        billing: common.value[contract.billingCycle],
        total: formatCurrency(contract.totalGross, locale.value, contract.currency),
        terms: contract.termsVersion ?? msg.value.contracts.noTerms,
        notice: formatMessage(msg.value.contracts.noticeDays, {
            days: contract.cancellationNoticeDays,
        }),
        confirmation: confirmationOf(contract),
        tone: CONFIRMATION_STATE_TONE[contract.confirmation.state],
        archived: contract.confirmation.archivedAt !== null,
    })),
);

/** Where the confirmation stands, with the day and address it was sent to once it was. */
function confirmationOf({ confirmation }: AdminSubscriberContract): string {
    const label = msg.value.contracts.states[confirmation.state];
    if (confirmation.state !== 'sent') return label;
    return formatMessage(label, {
        date: props.formatDate(confirmation.deliveredAt),
        address: confirmation.deliveredTo ?? '',
    });
}

const columns = computed<QTableColumn[]>(() => {
    const m = msg.value.contracts;
    return [
        { name: 'concluded', label: m.columnConcluded, field: 'concluded', align: 'left' },
        { name: 'status', label: m.columnStatus, field: 'status', align: 'left' },
        { name: 'start', label: m.columnStart, field: 'start', align: 'left' },
        { name: 'billing', label: m.columnBilling, field: 'billing', align: 'left' },
        { name: 'total', label: m.columnTotal, field: 'total', align: 'right' },
        { name: 'terms', label: m.columnTerms, field: 'terms', align: 'left' },
        { name: 'notice', label: m.columnNotice, field: 'notice', align: 'left' },
        {
            name: 'confirmation',
            label: m.columnConfirmation,
            field: 'confirmation',
            align: 'left',
        },
    ];
});
</script>

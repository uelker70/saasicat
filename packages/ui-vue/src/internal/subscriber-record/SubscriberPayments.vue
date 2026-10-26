<template>
    <AdminSection :title="msg.payments.title" :subtitle="msg.payments.subtitle" class="q-mb-md">
        <AdminErrorBanner :error="error" :title="msg.payments.loadFailed" :retry="retry" />
        <template v-if="!error">
            <div class="text-subtitle2 q-mb-xs">{{ msg.payments.invoicesTitle }}</div>
            <AdminTable
                :rows="invoiceRows"
                :columns="invoiceColumns"
                row-key="id"
                :loading="pending"
                :empty-text="msg.payments.invoicesEmpty"
                storage-key="subscriber-invoices"
            >
                <template v-if="documents || cancellation.available.value" #row-actions="{ row }">
                    <q-btn
                        v-if="documents && row.documentArchived"
                        flat
                        dense
                        no-caps
                        :label="msg.payments.download"
                        :aria-label="
                            formatMessage(msg.payments.downloadInvoice, { number: row.number })
                        "
                        :loading="documents.downloading.value === row.id"
                        :disable="documents.downloading.value !== null"
                        @click="documents.download(row.id)"
                    />
                    <q-btn
                        v-if="row.cancellable"
                        flat
                        dense
                        no-caps
                        :label="msg.payments.cancel"
                        :aria-label="
                            formatMessage(msg.payments.cancelInvoice, { number: row.number })
                        "
                        @click="cancellation.open(row.invoice)"
                    />
                </template>
            </AdminTable>
            <div class="text-subtitle2 q-mt-md q-mb-xs">{{ msg.payments.casesTitle }}</div>
            <AdminTable
                :rows="caseRows"
                :columns="caseColumns"
                row-key="id"
                :loading="pending"
                :empty-text="msg.payments.casesEmpty"
                storage-key="subscriber-cases"
            />
        </template>
        <InvoiceCancellationDialog :flow="cancellation" :record="record" />
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import type { AdminSubscriberPayments, AdminSubscriberDetails } from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import { invoiceStandingOf } from '../../client/invoice-standing.js';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import type { FileDownload } from '../../vue/use-file-download.js';
import type { InvoiceCancellationFlow } from '../../vue/use-invoice-cancellation.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import InvoiceCancellationDialog from './InvoiceCancellationDialog.vue';

// The tenant's invoices, the latest first, each with what it still owes after
// every payment, reversal and give-back and what it stands in relation to — a
// cancellation invoice, a replacement, an invoice cancelled —, and its cases
// still open to reconcile: what the gateway reported and no credit matched.
// An invoice that stands is cancelled here; a case is closed on the
// reconciliation page, with a note. Every invoice's archived document is
// downloaded beside it, where the platform serves it.
const props = defineProps<{
    payments: AdminSubscriberPayments | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** The page's own date format, so one page shows one. */
    formatDate: (value: string | null | undefined) => string;
    /** Cancelling an invoice, as the page's composable runs it. */
    cancellation: InvoiceCancellationFlow;
    /**
     * The download of an invoice's archived document; `null` where the
     * platform does not serve it (`invoices.read`).
     */
    documents: FileDownload | null;
    /** The subscriber's record, whose values a cancellation's corrections offer. */
    record: AdminSubscriberDetails | null;
}>();

const msg = useSaMessages('subscribers');
const kinds = useSaMessages('reconciliation');
const { locale } = useSuperAdminI18n();

const invoiceRows = computed(() =>
    (props.payments?.invoices ?? []).map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        issued: props.formatDate(invoice.issuedAt),
        due: props.formatDate(invoice.dueDate),
        total: formatCurrency(invoice.totalGross, locale.value, invoice.currency),
        owed: formatCurrency(invoice.owed, locale.value, invoice.currency),
        standing: invoiceStandingOf(invoice, msg.value.payments),
        cancellable: props.cancellation.canCancel(invoice),
        documentArchived: invoice.documentArchived,
        invoice,
    })),
);

const caseRows = computed(() =>
    (props.payments?.openCases ?? []).map((each) => ({
        id: each.id,
        recorded: props.formatDate(each.recordedAt),
        kind: kinds.value.kinds[each.kind],
        reference: each.reference,
        amount: formatCurrency(each.amount, locale.value, each.currency),
    })),
);

const invoiceColumns = computed<QTableColumn[]>(() => {
    const m = msg.value.payments;
    return [
        { name: 'number', label: m.columnNumber, field: 'number', align: 'left' },
        { name: 'standing', label: m.columnStanding, field: 'standing', align: 'left' },
        { name: 'issued', label: m.columnIssued, field: 'issued', align: 'left' },
        { name: 'due', label: m.columnDue, field: 'due', align: 'left' },
        { name: 'total', label: m.columnTotal, field: 'total', align: 'right' },
        { name: 'owed', label: m.columnOwed, field: 'owed', align: 'right' },
    ];
});

const caseColumns = computed<QTableColumn[]>(() => {
    const c = kinds.value.columns;
    return [
        { name: 'recorded', label: c.recordedAt, field: 'recorded', align: 'left' },
        { name: 'kind', label: c.kind, field: 'kind', align: 'left' },
        { name: 'reference', label: c.reference, field: 'reference', align: 'left' },
        { name: 'amount', label: c.amount, field: 'amount', align: 'right' },
    ];
});
</script>

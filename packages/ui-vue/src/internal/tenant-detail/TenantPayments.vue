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
                storage-key="tenant-payments-invoices"
            >
                <template v-if="cancellation.available.value" #row-actions="{ row }">
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
                storage-key="tenant-payments-cases"
            />
        </template>
        <InvoiceCancellationDialog :flow="cancellation" :record="record" />
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import type {
    AdminTenantInvoice,
    AdminTenantPayments,
    AdminTenantSubscriber,
} from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import type { InvoiceCancellationFlow } from '../../vue/use-invoice-cancellation.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import InvoiceCancellationDialog from './InvoiceCancellationDialog.vue';

// The tenant's invoices, the latest first, each with what it still owes after
// every payment, reversal and give-back and what it stands in relation to — a
// cancellation invoice, a replacement, an invoice cancelled —, and its cases
// still open to reconcile: what the gateway reported and no credit matched.
// An invoice that stands is cancelled here; a case is closed on the
// reconciliation page, with a note.
const props = defineProps<{
    payments: AdminTenantPayments | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** The page's own date format, so one page shows one. */
    formatDate: (value: string | null | undefined) => string;
    /** Cancelling an invoice, as the page's composable runs it. */
    cancellation: InvoiceCancellationFlow;
    /** The subscriber's record, whose values a cancellation's corrections offer. */
    record: AdminTenantSubscriber['subscriber'];
}>();

const msg = useSaMessages('tenants');
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
        standing: standingOf(invoice),
        cancellable: props.cancellation.canCancel(invoice),
        invoice,
    })),
);

/**
 * What `invoice` stands in relation to, by the numbers on the documents: what
 * it corrects, and what cancelled it — a replacement can be both.
 */
function standingOf({ correction, cancelledBy }: AdminTenantInvoice): string {
    const m = msg.value.payments;
    const corrects = correction
        ? formatMessage(correction.kind === 'cancellation' ? m.cancellationOf : m.replacementOf, {
              number: correction.of.number,
          })
        : null;
    const cancelled = cancelledBy
        ? formatMessage(m.cancelledBy, { number: cancelledBy.number })
        : null;
    return [corrects, cancelled].filter((part) => part !== null).join(' · ');
}

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

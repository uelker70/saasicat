<template>
    <AdminSection :title="msg.invoicesTitle" :subtitle="msg.invoicesSubtitle" class="q-mb-md">
        <AdminFilters class="q-mb-md">
            <q-toggle
                :model-value="overdueOnly"
                :label="msg.overdueOnly"
                @update:model-value="(value: boolean) => emit('update:overdueOnly', value)"
            />
        </AdminFilters>
        <AdminErrorBanner :error="list.error.value" :title="msg.loadFailed" :retry="list.reload" />
        <AdminEmptyState
            v-if="!list.loading.value && !list.error.value && rows.length === 0"
            :title="msg.invoicesEmpty"
            size="inline"
        />
        <AdminTable
            v-else-if="!list.error.value"
            :rows="rows"
            :columns="columns"
            row-key="id"
            :loading="list.loading.value"
            storage-key="open-invoices"
        >
            <template #body-cell-subscriber="{ row }">
                <q-td>
                    <router-link
                        :to="recordRoute(row.subscriberId)"
                        :aria-label="row.openLabel"
                        class="sa-link"
                    >
                        {{ row.subscriber }}
                    </router-link>
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
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import type { AdminOpenInvoice } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminEmptyState from '../../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminFilters from '../../ui/page/AdminFilters.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import type { PagedList } from '../../vue/use-paged-list.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// The invoices that still owe something, the oldest due date first: what each
// owes, how many days it is overdue, how it is paid and how its latest
// collection attempt ended — the list a dunning run starts from.
const props = defineProps<{
    list: PagedList<AdminOpenInvoice>;
    overdueOnly: boolean;
    /** Where a subscriber's record answers. */
    recordRoute: (subscriberId: string) => RouteLocationRaw;
}>();

const emit = defineEmits<{ (e: 'update:overdueOnly', value: boolean): void }>();

const msg = useSaMessages('openItems');
const { locale } = useSuperAdminI18n();

/** How the invoice is paid, by the payment method it is collected with. */
function paymentOf(invoice: AdminOpenInvoice): string {
    const m = msg.value.payment;
    if (!invoice.payment) return m.transfer;
    return formatMessage(m[invoice.payment.type], { last4: invoice.payment.last4 });
}

/** How the latest attempt ended, with the day it left or why it failed. */
function attemptOf(invoice: AdminOpenInvoice): string {
    const m = msg.value;
    const attempt = invoice.lastAttempt;
    if (!attempt) return m.noAttempt;
    const status = m.attempt[attempt.status];
    if (attempt.failureReason) {
        return formatMessage(m.attemptFailed, { status, reason: m.failure[attempt.failureReason] });
    }
    return attempt.submittedAt
        ? formatMessage(m.attemptOn, { status, day: attempt.submittedAt.slice(0, 10) })
        : status;
}

const rows = computed(() =>
    props.list.rows.value.map((invoice) => {
        const money = (amount: number) => formatCurrency(amount, locale.value, invoice.currency);
        return {
            id: invoice.id,
            number: invoice.number,
            due: invoice.dueDate,
            daysOverdue: invoice.daysOverdue > 0 ? String(invoice.daysOverdue) : '—',
            subscriberId: invoice.subscriber.id,
            subscriber: `${invoice.subscriber.customerNumber} · ${invoice.subscriber.legalName}`,
            openLabel: formatMessage(msg.value.openRecord, {
                customerNumber: invoice.subscriber.customerNumber,
            }),
            gross: money(invoice.totalGross),
            owed: money(invoice.owed),
            payment: paymentOf(invoice),
            lastAttempt: attemptOf(invoice),
        };
    }),
);

const columns = computed<QTableColumn[]>(() => {
    const m = msg.value;
    return [
        { name: 'number', label: m.columnNumber, field: 'number', align: 'left' },
        { name: 'due', label: m.columnDue, field: 'due', align: 'left' },
        { name: 'daysOverdue', label: m.columnDaysOverdue, field: 'daysOverdue', align: 'right' },
        { name: 'subscriber', label: m.columnSubscriber, field: 'subscriber', align: 'left' },
        { name: 'gross', label: m.columnGross, field: 'gross', align: 'right' },
        { name: 'owed', label: m.columnOwed, field: 'owed', align: 'right' },
        { name: 'payment', label: m.columnPayment, field: 'payment', align: 'left' },
        { name: 'lastAttempt', label: m.columnLastAttempt, field: 'lastAttempt', align: 'left' },
    ];
});
</script>

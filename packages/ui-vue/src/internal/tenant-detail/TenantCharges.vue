<template>
    <AdminSection :title="msg.charges.title" :subtitle="holderLine" class="q-mb-md">
        <AdminErrorBanner :error="error" :title="msg.charges.loadFailed" :retry="retry" />
        <AdminTable
            v-if="!error"
            :rows="rows"
            :columns="columns"
            row-key="id"
            :loading="pending"
            :empty-text="msg.charges.empty"
            storage-key="tenant-charges"
        />
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import type { AdminSubscriberAccount } from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// The charges of the tenant's subscriber, newest first as the platform orders
// them. Read only, and net: a charge's tax is decided when it is invoiced. No
// total — without invoices and payments, a sum would be read as what is owed.
const props = defineProps<{
    account: AdminSubscriberAccount | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** The page's own date format, so one page shows one. */
    formatDate: (value: string | null | undefined) => string;
}>();

const msg = useSaMessages('tenants');
const { locale } = useSuperAdminI18n();

const holderLine = computed(() => {
    if (!props.account) return undefined;
    const holder = props.account.holder;
    if (!holder) return msg.value.charges.noHolder;
    return formatMessage(msg.value.charges.holder, {
        customerNumber: holder.customerNumber,
        legalName: holder.legalName,
    });
});

const rows = computed(() =>
    (props.account?.entries ?? []).map(({ charge, title }) => ({
        id: charge.id,
        due: props.formatDate(charge.bookedAt),
        period: `${props.formatDate(charge.periodStart)} – ${props.formatDate(charge.periodEnd)}`,
        item: title ?? msg.value.charges.source[charge.source],
        kind: msg.value.charges.source[charge.source],
        origin: msg.value.charges.origin[charge.origin],
        amount: formatCurrency(charge.amountNet, locale.value, charge.currency),
    })),
);

const columns = computed<QTableColumn[]>(() => [
    { name: 'due', label: msg.value.charges.columnDue, field: 'due', align: 'left' },
    { name: 'period', label: msg.value.charges.columnPeriod, field: 'period', align: 'left' },
    { name: 'item', label: msg.value.charges.columnItem, field: 'item', align: 'left' },
    { name: 'kind', label: msg.value.charges.columnKind, field: 'kind', align: 'left' },
    { name: 'origin', label: msg.value.charges.columnOrigin, field: 'origin', align: 'left' },
    { name: 'amount', label: msg.value.charges.columnAmount, field: 'amount', align: 'right' },
]);
</script>

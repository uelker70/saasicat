<template>
    <AdminSection :title="msg.totalsTitle" :subtitle="msg.totalsSubtitle" class="q-mb-md">
        <AdminTable
            :rows="rows"
            :columns="columns"
            row-key="key"
            :loading="pending"
            :empty-text="msg.noInvoices"
            storage-key="invoice-totals"
        />
    </AdminSection>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { QTableColumn } from 'quasar';
import type { AdminInvoiceRegisterTotals, AdminInvoiceTotal } from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// What the months of the register add up to: a row per month, currency, tax
// treatment and rate, a month without invoices saying so rather than missing,
// and the whole span beneath — the figures an advisor reports from.
const props = defineProps<{
    totals: AdminInvoiceRegisterTotals | null;
    pending: boolean;
}>();

const msg = useSaMessages('invoices');
const payments = useSaMessages('subscribers');
const { locale } = useSuperAdminI18n();

function cellsOf(total: AdminInvoiceTotal) {
    const money = (amount: number) => formatCurrency(amount, locale.value, total.currency);
    return {
        treatment: formatMessage(payments.value.payments.taxTreatment[total.kind], {
            rate: total.rate,
        }),
        net: money(total.net),
        tax: money(total.tax),
        gross: money(total.gross),
    };
}

const NO_AMOUNT = { treatment: '', net: '', tax: '', gross: '' };

const rows = computed(() => {
    const totals = props.totals;
    if (!totals) return [];
    const months = totals.months.flatMap(({ month, totals: sums }) =>
        sums.length === 0
            ? [{ key: month, month, ...NO_AMOUNT, treatment: msg.value.noInvoices }]
            : sums.map((total, index) => ({
                  key: `${month}-${index}`,
                  month,
                  ...cellsOf(total),
              })),
    );
    const whole = formatMessage(msg.value.wholeSpan, { from: totals.from, until: totals.until });
    const span = totals.range.map((total, index) => ({
        key: `span-${index}`,
        month: whole,
        ...cellsOf(total),
    }));
    return [...months, ...span];
});

const columns = computed<QTableColumn[]>(() => {
    const m = msg.value;
    return [
        { name: 'month', label: m.columnMonth, field: 'month', align: 'left' },
        { name: 'treatment', label: m.columnTreatment, field: 'treatment', align: 'left' },
        { name: 'net', label: m.columnNet, field: 'net', align: 'right' },
        { name: 'tax', label: m.columnTax, field: 'tax', align: 'right' },
        { name: 'gross', label: m.columnGross, field: 'gross', align: 'right' },
    ];
});
</script>

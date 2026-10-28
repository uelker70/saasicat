<template>
    <AdminSection :title="msg.credits.title" :subtitle="msg.credits.subtitle" class="q-mb-md">
        <AdminErrorBanner :error="error" :title="msg.credits.loadFailed" :retry="retry" />
        <AdminTable
            v-if="!error"
            :rows="rows"
            :columns="columns"
            row-key="id"
            :loading="pending"
            :empty-text="msg.credits.empty"
            storage-key="subscriber-credits"
        >
            <template v-if="canPayOut" #row-actions="{ row }">
                <q-btn
                    v-if="row.payable"
                    flat
                    dense
                    no-caps
                    :label="msg.credits.payOut"
                    @click="openPayout(row.id)"
                />
            </template>
        </AdminTable>
        <SubscriberPayoutDialog
            v-model="payoutOpen"
            :credit="chosen"
            :today="today"
            :submit="submitPayout"
        />
    </AdminSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { QTableColumn } from 'quasar';
import {
    dayInZone,
    toCents,
    type AdminSubscriberCredit,
    type AdminSubscriberCredits,
    type AdminSubscriberPayout,
} from '@saasicat/core';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import { useInstallationDays } from '../../vue/use-installation-days.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import SubscriberPayoutDialog from './SubscriberPayoutDialog.vue';

// The credits of the tenant's subscriber, the oldest first as the platform
// orders them: where each comes from — a payment beyond its invoice, an invoice
// below zero, a reversal the gateway gave back, a payment's share of a cancelled
// invoice its replacement did not take —, what was paid out of it and
// what is still open. A credit is never offset against a later invoice; one with
// something open can be paid out here, where the gateway can no longer refund
// it.
const props = defineProps<{
    credits: AdminSubscriberCredits | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** The page's own way of writing a calendar day, so one page shows one. */
    formatDate: (value: string | null | undefined) => string;
    /** Whether the platform takes a payout. */
    canPayOut: boolean;
    /** The write, as the credits composable runs it behind the second factor. */
    payOut: (creditId: string, payout: AdminSubscriberPayout) => Promise<unknown>;
}>();

const msg = useSaMessages('subscribers');
const days = useInstallationDays();
const { locale } = useSuperAdminI18n();

const payoutOpen = ref(false);
const chosenId = ref<string | null>(null);
const chosen = computed<AdminSubscriberCredit | null>(
    () => props.credits?.credits.find((credit) => credit.id === chosenId.value) ?? null,
);
/**
 * Today in the installation's time zone, where the platform judges a payout's
 * day — not where the operator sits. Read when the dialog opens, so a page left
 * open overnight offers the day it is.
 */
const today = ref('');

function openPayout(creditId: string): void {
    if (!props.credits) return;
    today.value = dayInZone(new Date(), props.credits.timeZone);
    chosenId.value = creditId;
    payoutOpen.value = true;
}

function submitPayout(payout: AdminSubscriberPayout): Promise<unknown> {
    return chosenId.value ? props.payOut(chosenId.value, payout) : Promise.resolve(null);
}

function originOf(credit: AdminSubscriberCredit): string {
    const m = msg.value.credits;
    const { origin } = credit;
    const invoiceNumber = origin.invoiceNumber ?? m.unknownInvoice;
    if (origin.kind === 'payment') {
        return formatMessage(m.fromPayment, { paymentRef: origin.paymentRef, invoiceNumber });
    }
    if (origin.kind === 'reversal') {
        return formatMessage(m.fromReversal, { reversalRef: origin.reversalRef, invoiceNumber });
    }
    if (origin.kind === 'cancellation') {
        return formatMessage(m.fromCancellation, { paymentRef: origin.paymentRef, invoiceNumber });
    }
    return formatMessage(m.fromInvoice, { invoiceNumber });
}

const rows = computed(() =>
    (props.credits?.credits ?? []).map((credit) => {
        const money = (amount: number) => formatCurrency(amount, locale.value, credit.currency);
        return {
            id: credit.id,
            created: props.formatDate(days.ofMoment(credit.createdAt)),
            origin: originOf(credit),
            amount: money(credit.amount),
            paidOut: money((toCents(credit.amount) - toCents(credit.open)) / 100),
            open: money(credit.open),
            payable: credit.open > 0,
        };
    }),
);

const columns = computed<QTableColumn[]>(() => [
    { name: 'created', label: msg.value.credits.columnCreated, field: 'created', align: 'left' },
    { name: 'origin', label: msg.value.credits.columnOrigin, field: 'origin', align: 'left' },
    { name: 'amount', label: msg.value.credits.columnAmount, field: 'amount', align: 'right' },
    { name: 'paidOut', label: msg.value.credits.columnPaidOut, field: 'paidOut', align: 'right' },
    { name: 'open', label: msg.value.credits.columnOpen, field: 'open', align: 'right' },
]);
</script>

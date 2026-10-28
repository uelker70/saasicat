<template>
    <AdminSection :title="msg.creditsTitle" :subtitle="msg.creditsSubtitle" class="q-mb-md">
        <AdminErrorBanner :error="list.error.value" :title="msg.loadFailed" :retry="list.reload" />
        <AdminEmptyState
            v-if="!list.loading.value && !list.error.value && rows.length === 0"
            :title="msg.creditsEmpty"
            size="inline"
        />
        <AdminTable
            v-else-if="!list.error.value"
            :rows="rows"
            :columns="columns"
            row-key="id"
            :loading="list.loading.value"
            storage-key="open-credits"
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
            <template v-if="canPayOut" #row-actions="{ row }">
                <q-btn
                    flat
                    dense
                    no-caps
                    :label="texts.payOut"
                    :aria-label="
                        formatMessage(msg.payOutFor, { customerNumber: row.customerNumber })
                    "
                    @click="openPayout(row.credit)"
                />
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
import { dayInZone, type AdminOpenCredit, type AdminSubscriberPayout } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminTable from '../../ui/data/AdminTable.vue';
import AdminEmptyState from '../../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import type { PagedList } from '../../vue/use-paged-list.js';
import { useInstallationDays } from '../../vue/use-installation-days.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import SubscriberPayoutDialog from '../subscriber-record/SubscriberPayoutDialog.vue';

// The credits the operator still owes, the oldest first, each paid out from
// its row with the record's dialog — what it arose from in detail stays in the
// subscriber's record, one step away.
const props = defineProps<{
    list: PagedList<AdminOpenCredit>;
    /** The installation's zone a payout's day is judged in; `null` before the credits are read. */
    timeZone: string | null;
    canPayOut: boolean;
    payOut: (credit: AdminOpenCredit, payout: AdminSubscriberPayout) => Promise<unknown>;
    /** Where a subscriber's record answers. */
    recordRoute: (subscriberId: string) => RouteLocationRaw;
}>();

const msg = useSaMessages('openItems');
const subscriberTexts = useSaMessages('subscribers');
const texts = computed(() => subscriberTexts.value.credits);
const { locale } = useSuperAdminI18n();
const days = useInstallationDays();

const chosen = ref<AdminOpenCredit | null>(null);
const payoutOpen = ref(false);
const today = ref('');

function openPayout(credit: AdminOpenCredit): void {
    chosen.value = credit;
    // Today in the installation's zone, read when the dialog opens: no payout
    // lies after it, wherever the operator sits.
    today.value = props.timeZone ? dayInZone(new Date(), props.timeZone) : '';
    payoutOpen.value = true;
}

function submitPayout(payout: AdminSubscriberPayout): Promise<unknown> {
    return chosen.value ? props.payOut(chosen.value, payout) : Promise.resolve(null);
}

const rows = computed(() =>
    props.list.rows.value.map((credit) => {
        const money = (amount: number) => formatCurrency(amount, locale.value, credit.currency);
        return {
            id: credit.id,
            subscriberId: credit.subscriber.id,
            customerNumber: credit.subscriber.customerNumber,
            subscriber: `${credit.subscriber.customerNumber} · ${credit.subscriber.legalName}`,
            openLabel: formatMessage(msg.value.openRecord, {
                customerNumber: credit.subscriber.customerNumber,
            }),
            origin: msg.value.origin[credit.origin],
            created: days.ofMoment(credit.createdAt),
            amount: money(credit.amount),
            open: money(credit.open),
            credit,
        };
    }),
);

const columns = computed<QTableColumn[]>(() => {
    const m = msg.value;
    return [
        { name: 'subscriber', label: m.columnSubscriber, field: 'subscriber', align: 'left' },
        { name: 'origin', label: m.columnOrigin, field: 'origin', align: 'left' },
        { name: 'created', label: m.columnCreated, field: 'created', align: 'left' },
        { name: 'amount', label: m.columnAmount, field: 'amount', align: 'right' },
        { name: 'open', label: m.columnOwed, field: 'open', align: 'right' },
    ];
});
</script>

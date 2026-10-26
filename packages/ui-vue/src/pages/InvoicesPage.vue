<template>
    <AdminPage class="sa-invoices">
        <AdminHero :title="msg.title" :subtitle="msg.subtitle">
            <template #actions>
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminErrorBanner :error="error" :title="msg.loadFailed" :retry="reload" />

            <AdminFilters class="q-mb-lg">
                <q-input
                    v-model="from"
                    outlined
                    dense
                    mask="####-##"
                    inputmode="numeric"
                    :label="msg.from"
                    :hint="msg.monthHint"
                    debounce="400"
                />
                <q-input
                    v-model="until"
                    outlined
                    dense
                    mask="####-##"
                    inputmode="numeric"
                    :label="msg.until"
                    :hint="msg.monthHint"
                    debounce="400"
                    :error="refusal !== null"
                    :error-message="refusal ?? ''"
                />
            </AdminFilters>

            <InvoiceRegisterTotals :totals="totals" :pending="loading" />

            <AdminSection :title="msg.listTitle" :subtitle="msg.listSubtitle">
                <AdminEmptyState
                    v-if="!loading && !error && tableRows.length === 0"
                    :title="msg.empty"
                    size="inline"
                />
                <AdminTable
                    v-else
                    :rows="tableRows"
                    :columns="columns"
                    row-key="id"
                    :loading="loading"
                    storage-key="invoices"
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
                    <template
                        v-if="documents || cancellation.available.value"
                        #row-actions="{ row }"
                    >
                        <q-btn
                            v-if="documents && row.documentArchived"
                            flat
                            dense
                            no-caps
                            :label="texts.download"
                            :aria-label="
                                formatMessage(texts.downloadInvoice, { number: row.number })
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
                            :label="texts.cancel"
                            :aria-label="formatMessage(texts.cancelInvoice, { number: row.number })"
                            @click="openCancellation(row.invoice)"
                        />
                    </template>
                </AdminTable>
                <div v-if="hasMore" class="q-mt-sm">
                    <q-btn flat no-caps :label="msg.more" :loading="loading" @click="more" />
                </div>
            </AdminSection>

            <InvoiceCancellationDialog :flow="cancellation" :record="party.data.value" />
        </AdminBody>

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
import type { AdminInvoiceRegisterRow } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatCurrency } from '../client/i18n/currency.js';
import { formatMessage } from '../client/i18n/format.js';
import { invoiceStandingOf } from '../client/invoice-standing.js';
import type { invoicesResource } from '../client/resources/invoices.resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import InvoiceRegisterTotals from '../internal/invoice-register/InvoiceRegisterTotals.vue';
import InvoiceCancellationDialog from '../internal/subscriber-record/InvoiceCancellationDialog.vue';
import { useSuperAdminNotify } from '../quasar/notify.js';
import AdminTable from '../ui/data/AdminTable.vue';
import AdminEmptyState from '../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminFilters from '../ui/page/AdminFilters.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import { type ResourceOverride, useResource } from '../vue/resource-registry.js';
import { useStandardPageRoute } from '../vue/standard-page-routes.js';
import { useCancellationParty } from '../vue/use-cancellation-party.js';
import { useInvoiceCancellation } from '../vue/use-invoice-cancellation.js';
import { useInvoiceRegister } from '../vue/use-invoice-register.js';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { useSubscriberDownloads } from '../vue/use-subscriber-downloads.js';
import { useSuperAdminManifest } from '../vue/use-super-admin-context.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: every invoice the installation issued in the months
// picked, whichever tenant it was for, and what they add up to (`SC-ADM-042`).
//
// What it answers is the advisor's question for a month or a quarter — which
// invoices, and how much tax at which rate — without opening every
// subscriber's record. An invoice is cancelled, and its document downloaded,
// here as in the record.

const props = defineProps<{
    /** Override the resources for this page only; see AP3 §3.2. */
    resources?: {
        invoices?: ResourceOverride<(typeof invoicesResource)['ops']>;
        subscribers?: ResourceOverride<(typeof subscribersResource)['ops']>;
    };
}>();

const msg = useSaMessages('invoices');
const subscriberTexts = useSaMessages('subscribers');
const texts = computed(() => subscriberTexts.value.payments);
const { locale } = useSuperAdminI18n();
const notify = useSuperAdminNotify();
const subscribers = useResource('subscribers', props.resources?.subscribers);
const { from, until, refusal, rows, totals, loading, error, hasMore, reload, more } =
    useInvoiceRegister(useResource('invoices', props.resources?.invoices));

// What is served is the manifest's to say.
const shellManifest = useSuperAdminManifest();
const servedBy = computed(() => shellManifest);
const mfa = useMfaPrompt();
const downloads = useSubscriberDownloads(servedBy, subscribers, { notify });
const documents = computed(() => downloads.invoices.value);
// A cancellation adds two invoices and moves what the months add up to, so
// both are read again.
const cancellation = useInvoiceCancellation(servedBy, subscribers, {
    notify,
    mfa,
    onCancelled: reload,
});
const cancelling = ref<AdminInvoiceRegisterRow | null>(null);
// Named only while the dialog is open, so each opening reads the record as it
// is then — also for the subscriber of the opening before, corrected since or
// read in vain then.
const party = useCancellationParty(subscribers, () =>
    cancellation.target.value === null ? null : (cancelling.value?.subscriber.id ?? null),
);

function openCancellation(invoice: AdminInvoiceRegisterRow): void {
    cancelling.value = invoice;
    cancellation.open(invoice);
}

const standardPageRoute = useStandardPageRoute();

/** Where a subscriber's record answers — beside its list, wherever the shell put that. */
function recordRoute(subscriberId: string): RouteLocationRaw {
    return `${standardPageRoute('subscribers')}/${encodeURIComponent(subscriberId)}`;
}

const tableRows = computed(() =>
    rows.value.map((invoice) => {
        const money = (amount: number) => formatCurrency(amount, locale.value, invoice.currency);
        return {
            id: invoice.id,
            number: invoice.number,
            issued: invoice.issueDate,
            standing: invoiceStandingOf(invoice, texts.value),
            subscriberId: invoice.subscriber.id,
            subscriber: `${invoice.subscriber.customerNumber} · ${invoice.subscriber.legalName}`,
            openLabel: formatMessage(msg.value.openRecord, {
                customerNumber: invoice.subscriber.customerNumber,
            }),
            net: money(invoice.totalNet),
            tax: money(invoice.totalTax),
            gross: money(invoice.totalGross),
            document: invoice.documentArchived
                ? msg.value.documentArchived
                : msg.value.documentAwaited,
            documentArchived: invoice.documentArchived,
            cancellable: cancellation.canCancel(invoice),
            invoice,
        };
    }),
);

const columns = computed<QTableColumn[]>(() => {
    const m = msg.value;
    const p = texts.value;
    return [
        { name: 'number', label: p.columnNumber, field: 'number', align: 'left' },
        { name: 'issued', label: p.columnIssued, field: 'issued', align: 'left' },
        { name: 'standing', label: p.columnStanding, field: 'standing', align: 'left' },
        { name: 'subscriber', label: m.columnSubscriber, field: 'subscriber', align: 'left' },
        { name: 'net', label: m.columnNet, field: 'net', align: 'right' },
        { name: 'tax', label: m.columnTax, field: 'tax', align: 'right' },
        { name: 'gross', label: m.columnGross, field: 'gross', align: 'right' },
        { name: 'document', label: m.columnDocument, field: 'document', align: 'left' },
    ];
});
</script>

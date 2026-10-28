<template>
    <div class="sa-contract-dossier">
        <AdminErrorBanner
            :error="dossier.error.value"
            :title="msg.contracts.dossier.loadFailed"
            :retry="dossier.reload"
        />
        <p v-if="!read && dossier.pending.value" class="sa-contract-dossier__note">
            {{ common.loading }}
        </p>
        <template v-else-if="read">
            <AdminBanner
                v-if="read.integrity === 'mismatch'"
                tone="warning"
                :title="msg.contracts.dossier.integrity.mismatch"
            />
            <p class="sa-contract-dossier__note">{{ msg.contracts.dossier.frozen }}</p>
            <p v-if="read.partiesMigrated" class="sa-contract-dossier__note">
                {{ msg.contracts.dossier.partiesMigrated }}
            </p>
            <div class="sa-contract-dossier__facts">
                <KvBlock
                    :label="msg.contracts.dossier.concluded"
                    :value="formatDate(days.ofMoment(contract.concludedAt))"
                />
                <KvBlock
                    :label="msg.contracts.dossier.agreed"
                    :value="formatDate(days.ofMoment(read.agreedAt))"
                />
                <KvBlock
                    :label="msg.contracts.dossier.terms"
                    :value="contract.termsVersion ?? msg.contracts.noTerms"
                />
                <KvBlock :label="msg.contracts.dossier.notice" :value="notice" />
                <KvBlock
                    v-if="contract.minimumTermUntil"
                    :label="msg.contracts.dossier.minimumTerm"
                    :value="formatDate(days.lastBefore(contract.minimumTermUntil))"
                />
                <KvBlock :label="msg.contracts.dossier.totals" :value="totals" />
            </div>

            <h4 class="sa-contract-dossier__heading">{{ msg.contracts.dossier.linesTitle }}</h4>
            <ContractLines
                :lines="read.lines"
                :format-date="formatDate"
                :catalog-route="catalogRoute"
            />

            <h4 class="sa-contract-dossier__heading">{{ msg.contracts.dossier.invoicesTitle }}</h4>
            <ul v-if="read.invoices.length > 0" class="sa-contract-dossier__list">
                <li v-for="invoice in read.invoices" :key="invoice.id">
                    <a v-if="invoicesAnchor" :href="`#${invoicesAnchor}`" class="sa-link">{{
                        invoice.number
                    }}</a>
                    <span v-else>{{ invoice.number }}</span>
                    · {{ formatDate(invoice.issueDate) }} ·
                    {{ formatCurrency(invoice.totalGross, locale, invoice.currency) }}
                </li>
            </ul>
            <p v-else class="sa-contract-dossier__note">{{ msg.contracts.dossier.noInvoices }}</p>

            <h4 class="sa-contract-dossier__heading">{{ msg.contracts.dossier.idsTitle }}</h4>
            <ul class="sa-contract-dossier__list">
                <li v-for="id in ids" :key="`${id.label}-${id.value}`">
                    {{ id.label }}: <code>{{ id.value }}</code>
                    <q-btn
                        flat
                        dense
                        round
                        size="sm"
                        icon="content_copy"
                        :aria-label="
                            formatMessage(msg.contracts.dossier.copyId, {
                                label: id.label,
                                id: id.value,
                            })
                        "
                        @click="copy.copy(id.value)"
                    />
                </li>
            </ul>

            <h4 class="sa-contract-dossier__heading">{{ msg.contracts.confirmation }}</h4>
            <p class="sa-contract-dossier__note">{{ confirmationState }}</p>
            <q-btn
                v-if="read.integrity === 'intact'"
                flat
                no-caps
                icon="download"
                :label="msg.contracts.download"
                :aria-label="
                    formatMessage(msg.contracts.downloadConfirmation, {
                        date: formatDate(days.ofMoment(contract.concludedAt)),
                    })
                "
                :loading="downloads.downloading.value === contract.id"
                :disable="downloads.downloading.value !== null"
                @click="downloads.download(contract.id)"
            />
            <p v-else-if="read.integrity !== 'mismatch'" class="sa-contract-dossier__note">
                {{ msg.contracts.dossier.integrity[read.integrity] }}
            </p>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { AdminSubscriberContract, ContractLineItemKind } from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import KvBlock from '../../ui/data/KvBlock.vue';
import AdminBanner from '../../ui/feedback/AdminBanner.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import type { ContractDossier } from '../../vue/use-contract-dossier.js';
import type { CopyText } from '../../vue/use-copy-text.js';
import type { FileDownload } from '../../vue/use-file-download.js';
import { useInstallationDays } from '../../vue/use-installation-days.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import ContractLines from './ContractLines.vue';

// One contract, opened: what it froze, the invoices issued under it, the ids
// to copy, and its confirmation — offered for download only where the archived
// file still matches the checksum recorded when it was rendered (`SC-ADM-041`).
const props = defineProps<{
    /** The contract as the timeline lists it. */
    contract: AdminSubscriberContract;
    dossier: ContractDossier;
    /** The page's own way of writing a calendar day, so one page shows one. */
    formatDate: (value: string | null | undefined) => string;
    downloads: FileDownload;
    copy: CopyText;
    /** Where the record's invoices are on the page; `null` where it shows none. */
    invoicesAnchor: string | null;
    catalogRoute: (kind: Exclude<ContractLineItemKind, 'discount'>) => RouteLocationRaw | null;
}>();

const msg = useSaMessages('subscribers');
const days = useInstallationDays();
const common = useSaMessages('common');
const { locale } = useSuperAdminI18n();

/** The dossier read for this contract; one read for another is not shown here. */
const read = computed(() => {
    const data = props.dossier.data.value;
    return data && data.contract.id === props.contract.id ? data : null;
});

/** Where the confirmation stands, with the day and address it was sent to once it was. */
const confirmationState = computed(() => {
    const { confirmation } = props.contract;
    const label = msg.value.contracts.states[confirmation.state];
    if (confirmation.state !== 'sent') return label;
    return formatMessage(label, {
        date: props.formatDate(days.ofMoment(confirmation.deliveredAt)),
        address: confirmation.deliveredTo ?? '',
    });
});

const notice = computed(() =>
    formatMessage(msg.value.contracts.noticeDays, { days: props.contract.cancellationNoticeDays }),
);

const totals = computed(() => {
    const data = read.value;
    if (!data) return '';
    const money = (amount: number) => formatCurrency(amount, locale.value, props.contract.currency);
    return formatMessage(msg.value.contracts.dossier.totalsOf, {
        subtotal: money(data.subtotalNet),
        discount: money(data.discountNet),
        net: money(data.totalNet),
        gross: money(props.contract.totalGross),
    });
});

const ids = computed(() => {
    const data = read.value;
    if (!data) return [];
    const m = msg.value.contracts.dossier;
    return [
        { label: m.contractId, value: props.contract.id },
        ...(data.originalOfferId ? [{ label: m.offerId, value: data.originalOfferId }] : []),
        ...(data.originalPlanVersionId
            ? [{ label: m.planVersionId, value: data.originalPlanVersionId }]
            : []),
        ...data.originalBundleVersionIds.map((value) => ({ label: m.bundleVersionId, value })),
    ];
});
</script>

<style scoped>
.sa-contract-dossier__note {
    color: var(--sa-color-fg-muted);
    margin: 0 0 var(--sa-space-2);
}
.sa-contract-dossier__facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--sa-space-3);
    margin: var(--sa-space-3) 0;
}
.sa-contract-dossier__heading {
    font-size: var(--sa-text-sm);
    font-weight: var(--sa-weight-semibold);
    margin: var(--sa-space-4) 0 var(--sa-space-2);
}
.sa-contract-dossier__list {
    margin: 0;
    padding-left: var(--sa-space-5);
}
</style>

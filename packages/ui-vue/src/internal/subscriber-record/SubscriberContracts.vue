<template>
    <AdminSection :title="msg.contracts.title" :subtitle="msg.contracts.subtitle" class="q-mb-md">
        <AdminErrorBanner :error="error" :title="msg.contracts.loadFailed" :retry="retry" />
        <p v-if="pending && !contracts" class="sa-subscriber-contracts__note">
            {{ common.loading }}
        </p>
        <p
            v-else-if="contracts && contracts.contracts.length === 0"
            class="sa-subscriber-contracts__note"
        >
            {{ msg.contracts.empty }}
        </p>
        <template v-else-if="contracts">
            <div class="sa-subscriber-contracts__as-of">
                <q-input
                    v-model="asOf"
                    outlined
                    dense
                    clearable
                    stack-label
                    type="date"
                    :label="msg.contracts.asOf"
                />
                <p v-if="noneInForce" class="sa-subscriber-contracts__note" role="status">
                    {{ msg.contracts.noneInForce }}
                </p>
            </div>
            <div
                v-for="timeline in timelines"
                :key="timeline.tenantId"
                class="sa-subscriber-contracts__tenant"
            >
                <h3 class="sa-subscriber-contracts__tenant-name">{{ timeline.name }}</h3>
                <AdminAccordion
                    v-for="entry in timeline.entries"
                    :key="entry.contract.id"
                    :open="dossier.openId.value === entry.contract.id"
                    @update:open="dossier.toggle(entry.contract.id)"
                >
                    <!-- The separators are text: the header names the trigger, and is read as one. -->
                    <template #header>
                        <span class="sa-subscriber-contracts__period">{{ entry.period }}</span
                        >{{ ' · '
                        }}<span class="sa-subscriber-contracts__changes">{{ entry.changes }}</span
                        >{{ ' · ' }}<span>{{ entry.total }}</span>
                    </template>
                    <template #header-actions>
                        <AdminStatusPill
                            v-if="entry.markedOn"
                            :label="entry.markedOn"
                            tone="primary"
                            size="sm"
                        />
                        <AdminStatusPill :label="entry.status" tone="muted" size="sm" />
                        <AdminStatusPill :label="entry.confirmation" :tone="entry.tone" size="sm" />
                    </template>
                    <ContractDossierView
                        :contract="entry.contract"
                        :dossier="dossier"
                        :format-date="formatDate"
                        :downloads="downloads"
                        :copy="copy"
                        :invoices-anchor="invoicesAnchor"
                        :catalog-route="catalogRoute"
                    />
                </AdminAccordion>
            </div>
        </template>
    </AdminSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
    AdminSubscriberContract,
    AdminSubscriberContracts,
    AdminSubscriberTenant,
    ContractLineItemKind,
} from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import {
    contractChangePartsOf,
    contractTimelinesOf,
    inForceOn,
    type ContractTimeline,
} from '../../client/contract-timeline.js';
import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminStatusPill from '../../ui/data/AdminStatusPill.vue';
import AdminErrorBanner from '../../ui/feedback/AdminErrorBanner.vue';
import AdminAccordion from '../../ui/page/AdminAccordion.vue';
import AdminSection from '../../ui/page/AdminSection.vue';
import type { ContractDossier } from '../../vue/use-contract-dossier.js';
import type { CopyText } from '../../vue/use-copy-text.js';
import type { FileDownload } from '../../vue/use-file-download.js';
import { CONFIRMATION_STATE_TONE } from '../../vue/use-subscriber-contracts.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';
import ContractDossierView from './ContractDossierView.vue';

// The subscriber's contracts, one timeline per tenant with the latest start
// first, each naming what it changed against the one before it and where its
// confirmation stands; a contract opens into what it froze (`SC-ADM-041`,
// `SC-AUD-016`). A day picked marks the contracts in force on it.
const props = defineProps<{
    contracts: AdminSubscriberContracts | null;
    pending: boolean;
    error: unknown | null;
    retry: () => void | Promise<void>;
    /** The tenants the record names, which the timelines are headed by. */
    tenants: readonly AdminSubscriberTenant[];
    /** The page's own date format, so one page shows one. */
    formatDate: (value: string | null | undefined) => string;
    /** The confirmation's download, as the page's composable runs it. */
    downloads: FileDownload;
    /** The contract open, and its dossier. */
    dossier: ContractDossier;
    copy: CopyText;
    /** Where the record's invoices are on the page; `null` where it shows none. */
    invoicesAnchor: string | null;
    /** Where the catalogue shows a plan's or an add-on's kind; `null` where it is not served. */
    catalogRoute: (kind: Exclude<ContractLineItemKind, 'discount'>) => RouteLocationRaw | null;
}>();

const msg = useSaMessages('subscribers');
const common = useSaMessages('common');
const { locale } = useSuperAdminI18n();

/** A calendar day, or `''` while none is picked. */
const asOf = ref<string | null>('');

const day = computed(() => asOf.value ?? '');

const noneInForce = computed(
    () =>
        day.value !== '' &&
        !(props.contracts?.contracts ?? []).some((contract) => inForceOn(contract, day.value)),
);

const timelines = computed(() =>
    contractTimelinesOf(props.contracts?.contracts ?? [], props.tenants).map((timeline) => ({
        tenantId: timeline.tenantId,
        name: tenantNameOf(timeline),
        entries: timeline.contracts.map((contract) => ({
            contract,
            period: periodOf(contract),
            changes: changesOf(contract),
            total: formatMessage(msg.value.contracts.perPeriod, {
                amount: formatCurrency(contract.totalGross, locale.value, contract.currency),
                cycle: common.value[contract.billingCycle],
            }),
            markedOn:
                day.value !== '' && inForceOn(contract, day.value)
                    ? formatMessage(msg.value.contracts.inForce, {
                          day: props.formatDate(day.value),
                      })
                    : null,
            status: msg.value.contracts.statuses[contract.status],
            // The state alone: the day and address it was sent to are in the
            // contract opened, so the header fits the narrowest screen.
            confirmation: msg.value.contracts.statesShort[contract.confirmation.state],
            tone: CONFIRMATION_STATE_TONE[contract.confirmation.state],
        })),
    })),
);

function tenantNameOf({ tenant, tenantId }: ContractTimeline): string {
    const m = msg.value.contracts;
    if (!tenant?.known) return formatMessage(m.tenantUnknown, { tenantId });
    return formatMessage(m.tenant, { name: tenant.name ?? tenant.slug ?? tenantId });
}

function periodOf(contract: AdminSubscriberContract): string {
    const m = msg.value.contracts;
    if (contract.neverInForce) return m.neverInForce;
    const from = props.formatDate(contract.firstDay);
    if (contract.lastDay === null) return formatMessage(m.running, { from });
    return formatMessage(m.period, { from, until: props.formatDate(contract.lastDay) });
}

function changesOf(contract: AdminSubscriberContract): string {
    const changes = msg.value.contracts.changes;
    return contractChangePartsOf(contract.change)
        .map((part) => formatMessage(changes[part.kind], { title: part.title ?? '' }))
        .join(' · ');
}
</script>

<style scoped>
.sa-subscriber-contracts__note {
    color: var(--sa-color-fg-muted);
    margin: 0;
}
.sa-subscriber-contracts__as-of {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sa-space-3);
    margin-bottom: var(--sa-space-4);
}
.sa-subscriber-contracts__tenant + .sa-subscriber-contracts__tenant {
    margin-top: var(--sa-space-5);
}
.sa-subscriber-contracts__tenant-name {
    font-size: var(--sa-text-md);
    font-weight: var(--sa-weight-semibold);
    margin-bottom: var(--sa-space-2);
}
.sa-subscriber-contracts__period {
    font-weight: var(--sa-weight-medium);
}
.sa-subscriber-contracts__changes {
    color: var(--sa-color-fg-muted);
}
</style>

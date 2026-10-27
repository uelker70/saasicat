<template>
    <AdminPage class="sa-subscriber-record">
        <AdminHero :title="heading">
            <template #actions>
                <q-btn
                    flat
                    no-caps
                    icon="arrow_back"
                    :label="msg.record.backToList"
                    @click="goBack"
                />
            </template>
        </AdminHero>

        <!-- A failed read is shown, not read as a subscriber with nothing in its record. -->
        <AdminBody
            :loading="record.pending.value && !record.data.value"
            :empty="!record.data.value && !record.error.value"
        >
            <AdminErrorBanner
                :error="record.error.value"
                :title="msg.record.loadFailed"
                :retry="record.reload"
            />
            <template v-if="record.data.value">
                <SubscriberMasterData
                    :standing="record.data.value"
                    :pending="record.pending.value"
                    :error="null"
                    :retry="record.reload"
                    :corrections="corrections"
                />
                <SubscriberTenants
                    :tenants="record.data.value.tenants"
                    :tenant-route="tenantRoute"
                />
                <SubscriberHistory
                    v-if="corrections.available.value"
                    :history="corrections.history"
                />

                <!-- The charges, where the platform keeps a journal -->
                <SubscriberCharges
                    v-if="account.available.value"
                    :account="account.data.value"
                    :pending="account.pending.value"
                    :error="account.error.value"
                    :retry="account.reload"
                    :format-date="formatDate"
                />

                <!-- The credits, where the platform records what collections brought -->
                <SubscriberCredits
                    v-if="credits.available.value"
                    :credits="credits.data.value"
                    :pending="credits.pending.value"
                    :error="credits.error.value"
                    :retry="credits.reload"
                    :format-date="formatDate"
                    :can-pay-out="credits.canPayOut.value"
                    :pay-out="credits.payOut"
                />

                <!-- The invoices with what each owes, and what is open to reconcile -->
                <SubscriberPayments
                    v-if="payments.available.value"
                    :id="INVOICES_ANCHOR"
                    :payments="payments.data.value"
                    :pending="payments.pending.value"
                    :error="payments.error.value"
                    :retry="payments.reload"
                    :format-date="formatDate"
                    :cancellation="cancellation"
                    :record="record.data.value.subscriber"
                    :documents="downloads.invoices.value"
                />

                <!-- The contracts per tenant, each opening into what it froze -->
                <SubscriberContracts
                    v-if="contracts.available.value && downloads.confirmations.value"
                    :contracts="contracts.data.value"
                    :pending="contracts.pending.value"
                    :error="contracts.error.value"
                    :retry="contracts.reload"
                    :tenants="record.data.value.tenants"
                    :format-date="formatDate"
                    :downloads="downloads.confirmations.value"
                    :dossier="dossier"
                    :copy="copy"
                    :invoices-anchor="payments.available.value ? INVOICES_ANCHOR : null"
                    :catalog-route="catalogRoute"
                />
            </template>
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
import { computed, nextTick, watch } from 'vue';
import type { StandardPageKey } from '@saasicat/core';
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router';

import { formatMessage } from '../client/i18n/format.js';
import { servesStandardPage } from '../client/nav-builder.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import SubscriberCharges from '../internal/subscriber-record/SubscriberCharges.vue';
import SubscriberContracts from '../internal/subscriber-record/SubscriberContracts.vue';
import SubscriberCredits from '../internal/subscriber-record/SubscriberCredits.vue';
import SubscriberHistory from '../internal/subscriber-record/SubscriberHistory.vue';
import SubscriberMasterData from '../internal/subscriber-record/SubscriberMasterData.vue';
import SubscriberPayments from '../internal/subscriber-record/SubscriberPayments.vue';
import SubscriberTenants from '../internal/subscriber-record/SubscriberTenants.vue';
import { useSuperAdminNotify } from '../quasar/notify.js';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import { type ResourceOverride, useResource } from '../vue/resource-registry.js';
import { contractAnchorOf, useContractDossier } from '../vue/use-contract-dossier.js';
import { useCopyText } from '../vue/use-copy-text.js';
import { useStandardPageRoute } from '../vue/standard-page-routes.js';
import { useInvoiceCancellation } from '../vue/use-invoice-cancellation.js';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { useSubscriberAccount } from '../vue/use-subscriber-account.js';
import { useSubscriberContracts } from '../vue/use-subscriber-contracts.js';
import { useSubscriberCorrections } from '../vue/use-subscriber-corrections.js';
import { useSubscriberCredits } from '../vue/use-subscriber-credits.js';
import { useSubscriberDownloads } from '../vue/use-subscriber-downloads.js';
import { useSubscriberPayments } from '../vue/use-subscriber-payments.js';
import { useSubscriberRecord } from '../vue/use-subscriber-record.js';
import { useSuperAdminManifest } from '../vue/use-super-admin-context.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';

// Platform standard page: everything about one subscriber, in one record
// (`SC-ADM-021`) — its master data and corrections, every tenant it was linked
// to, its charges, credits and invoices, and its contracts with their
// confirmations. Reached by the subscriber's id, so it stays where it is once
// the tenant is gone: a credit is paid out and an invoice cancelled from here
// whether the tenant lives or not.

const props = defineProps<{
    /** Override the resource for this page only; see AP3 §3.2. */
    resources?: ResourceOverride<(typeof subscribersResource)['ops']>;
    /**
     * Which subscriber. Defaults to the route's `id` param, which is where the
     * record's route puts it — an app only passes this when it mounts the page
     * outside such a route.
     */
    subscriberId?: string;
}>();

const msg = useSaMessages('subscribers');
const notify = useSuperAdminNotify();
const subscribers = useResource('subscribers', props.resources);
const route = useRoute();
const router = useRouter();
const subscriberId = computed(() => props.subscriberId ?? String(route.params.id ?? ''));

// What is served is the manifest's to say.
const shellManifest = useSuperAdminManifest();
const servedBy = computed(() => shellManifest);
const mfa = useMfaPrompt();

const record = useSubscriberRecord(subscriberId, servedBy, subscribers);
// The corrections, the payout and the cancellation share the page's one
// second-factor dialog.
const corrections = useSubscriberCorrections(subscriberId, servedBy, subscribers, {
    notify,
    mfa,
    onChanged: () => record.reload(),
});
const account = useSubscriberAccount(subscriberId, servedBy, subscribers);
const credits = useSubscriberCredits(subscriberId, servedBy, subscribers, { notify, mfa });
const payments = useSubscriberPayments(subscriberId, servedBy, subscribers);
const contracts = useSubscriberContracts(subscriberId, servedBy, subscribers);
const dossier = useContractDossier(subscriberId, subscribers);
// A contract the address names is opened, and brought into view once the
// timeline shows it.
const linkedContract = computed(() =>
    typeof route.query.contract === 'string' && route.query.contract !== ''
        ? route.query.contract
        : null,
);
watch(
    linkedContract,
    (contractId) => {
        if (contractId) dossier.open(contractId);
    },
    { immediate: true },
);
watch(
    () => contracts.data.value,
    async (loaded) => {
        const contractId = linkedContract.value;
        if (!loaded || !contractId) return;
        await nextTick();
        document.getElementById(contractAnchorOf(contractId))?.scrollIntoView?.({ block: 'start' });
    },
);
const copy = useCopyText({ notify });
const downloads = useSubscriberDownloads(servedBy, subscribers, { notify });
// What was paid for a cancelled invoice moves, so the credits are read again
// with the invoices.
const cancellation = useInvoiceCancellation(servedBy, subscribers, {
    notify,
    mfa,
    onCancelled: () => Promise.all([payments.reload(), credits.reload()]),
});

const heading = computed(() => {
    const subscriber = record.data.value?.subscriber;
    if (!subscriber) return msg.value.record.title;
    return formatMessage(msg.value.record.heading, {
        customerNumber: subscriber.customerNumber,
        legalName: subscriber.legalName,
    });
});

/** A moment as the day it fell on, the way the tenant's page shows them. */
function formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    return String(value).slice(0, 10);
}

/** The invoices section, which a contract's invoices lead to. */
const INVOICES_ANCHOR = 'sa-subscriber-invoices';

/** The catalogue's page of plans or of add-ons, where the manifest serves it. */
const CATALOG_PAGES: Readonly<Record<'plan' | 'bundle', StandardPageKey>> = {
    plan: 'plans',
    bundle: 'bundles',
};

// Where the shell put each standard page — the navigation's own mapping.
const standardPageRoute = useStandardPageRoute();

function catalogRoute(kind: 'plan' | 'bundle'): RouteLocationRaw | null {
    const key = CATALOG_PAGES[kind];
    const manifest = servedBy.value;
    return manifest && servesStandardPage(manifest, key) ? standardPageRoute(key) : null;
}

/** Where a tenant's page answers — beside this page, under the same base. */
function tenantRoute(slug: string): RouteLocationRaw {
    return `/admin/tenants/${encodeURIComponent(slug)}`;
}

/**
 * The hero back button navigates rather than rendering a link, as every other
 * hero in the package does.
 */
function goBack(): void {
    void router.push(standardPageRoute('subscribers'));
}
</script>

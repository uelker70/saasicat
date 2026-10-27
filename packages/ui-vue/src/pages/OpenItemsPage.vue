<template>
    <AdminPage class="sa-open-items">
        <AdminHero :title="msg.title" :subtitle="msg.subtitle">
            <template #actions>
                <AdminRefreshBtn :loading="loading" @refresh="open.reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminErrorBanner
                :error="open.totals.error.value"
                :title="msg.loadFailed"
                :retry="open.totals.reload"
            />
            <AdminStatistics :label="msg.totalsLabel">
                <AdminKpi
                    v-for="tile in tiles"
                    :key="tile.id"
                    :label="tile.label"
                    :value="tile.value"
                    :tone="tile.tone"
                />
            </AdminStatistics>

            <OpenInvoices
                v-model:overdue-only="open.overdueOnly.value"
                :list="open.invoices"
                :record-route="recordRoute"
            />
            <OpenCredits
                :list="open.credits"
                :time-zone="open.timeZone.value"
                :can-pay-out="open.canPayOut.value"
                :pay-out="open.payOut"
                :record-route="recordRoute"
            />
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
import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';

import { formatCurrency } from '../client/i18n/currency.js';
import { formatMessage } from '../client/i18n/format.js';
import type { openItemsResource } from '../client/resources/open-items.resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import OpenCredits from '../internal/open-items/OpenCredits.vue';
import OpenInvoices from '../internal/open-items/OpenInvoices.vue';
import { useSuperAdminNotify } from '../quasar/notify.js';
import AdminKpi from '../ui/data/AdminKpi.vue';
import AdminStatistics from '../ui/data/AdminStatistics.vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import { type ResourceOverride, useResource } from '../vue/resource-registry.js';
import { useStandardPageRoute } from '../vue/standard-page-routes.js';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { useOpenItems } from '../vue/use-open-items.js';
import { useSuperAdminManifest } from '../vue/use-super-admin-context.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: what subscribers still owe and what they are still
// owed, across every tenant, deleted ones included (`SC-ADM-044`) — the list a
// dunning run and a payout run start from, without opening one record after
// another.

const props = defineProps<{
    /** Override the resources for this page only; see AP3 §3.2. */
    resources?: {
        openItems?: ResourceOverride<(typeof openItemsResource)['ops']>;
        subscribers?: ResourceOverride<(typeof subscribersResource)['ops']>;
    };
}>();

const msg = useSaMessages('openItems');
const { locale } = useSuperAdminI18n();
const shellManifest = useSuperAdminManifest();
const mfa = useMfaPrompt();
const open = useOpenItems(
    computed(() => shellManifest),
    useResource('openItems', props.resources?.openItems),
    useResource('subscribers', props.resources?.subscribers),
    { notify: useSuperAdminNotify(), mfa },
);

const loading = computed(
    () => open.invoices.loading.value || open.credits.loading.value || open.totals.pending.value,
);

const standardPageRoute = useStandardPageRoute();

/** Where a subscriber's record answers — beside its list, wherever the shell put that. */
function recordRoute(subscriberId: string): RouteLocationRaw {
    return `${standardPageRoute('subscribers')}/${encodeURIComponent(subscriberId)}`;
}

/** A tile per currency for what is owed and overdue, and one per currency for what credits hold. */
const tiles = computed(() => {
    const totals = open.totals.data.value;
    if (!totals) return [];
    const m = msg.value;
    const money = (amount: number, currency: string) =>
        formatCurrency(amount, locale.value, currency);
    const owed = totals.invoices.flatMap(({ currency, owed: amount, overdue }) => [
        {
            id: `owed-${currency}`,
            label: formatMessage(m.owed, { currency }),
            value: money(amount, currency),
            tone: 'neutral' as const,
        },
        {
            id: `overdue-${currency}`,
            label: formatMessage(m.overdue, { currency }),
            value: money(overdue, currency),
            tone: overdue > 0 ? ('warn' as const) : ('neutral' as const),
        },
    ]);
    const credits = totals.credits.map(({ currency, open: amount }) => ({
        id: `credits-${currency}`,
        label: formatMessage(m.creditsOpen, { currency }),
        value: money(amount, currency),
        tone: 'info' as const,
    }));
    const all = [...owed, ...credits];
    return all.length > 0
        ? all
        : [{ id: 'nothing', label: m.nothingOpen, value: '—', tone: 'muted' as const }];
});
</script>

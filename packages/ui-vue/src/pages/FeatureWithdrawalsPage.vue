<template>
    <AdminPage class="sa-feature-withdrawals">
        <AdminHero :title="msg.title" :subtitle="msg.subtitle">
            <template #actions>
                <q-btn
                    flat
                    no-caps
                    icon="block"
                    :label="msg.withdraw"
                    @click="announcement.open()"
                />
                <AdminRefreshBtn :loading="loading" @refresh="reload" />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminErrorBanner :error="error" :title="msg.loadFailed" :retry="reload" />

            <AdminSection :title="msg.listTitle">
                <AdminEmptyState
                    v-if="!loading && !error && tableRows.length === 0"
                    :title="msg.empty"
                    :description="msg.emptyHint"
                    size="inline"
                />
                <AdminTable
                    v-else
                    :rows="tableRows"
                    :columns="columns"
                    row-key="id"
                    :loading="loading"
                    storage-key="feature-withdrawals"
                >
                    <template #body-cell-status="{ row }">
                        <q-td>
                            <AdminStatusPill
                                :label="msg.status[row.status as FeatureWithdrawalStatus]"
                                :tone="STATUS_TONE[row.status as FeatureWithdrawalStatus]"
                                size="sm"
                            />
                        </q-td>
                    </template>
                    <template #row-actions="{ row }">
                        <AdminRowActions
                            :actions="[
                                {
                                    key: 'lift',
                                    label: msg.lift,
                                    icon: 'undo',
                                    hidden: !row.canLift,
                                },
                            ]"
                            @action="openLift(row.id)"
                        />
                    </template>
                </AdminTable>
            </AdminSection>
        </AdminBody>

        <FeatureWithdrawDialog :flow="announcement" />
        <FeatureWithdrawalLiftDialog v-model="liftOpen" :row="liftRow" :lift="lift" />

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
import type { FeatureWithdrawalView } from '@saasicat/core';

import {
    canLiftFeatureWithdrawal,
    featureWithdrawalStatusOf,
    type FeatureWithdrawalStatus,
} from '../client/feature-withdrawal.js';
import { formatMessage, formatMoment } from '../client/i18n/format.js';
import type { catalogResource } from '../client/resources/catalog.resource.js';
import type { featureWithdrawalsResource } from '../client/resources/feature-withdrawals.resource.js';
import FeatureWithdrawDialog from '../features/feature-withdrawal/FeatureWithdrawDialog.vue';
import FeatureWithdrawalLiftDialog from '../features/feature-withdrawal/FeatureWithdrawalLiftDialog.vue';
import AdminRowActions from '../ui/data/AdminRowActions.vue';
import AdminStatusPill from '../ui/data/AdminStatusPill.vue';
import AdminTable from '../ui/data/AdminTable.vue';
import AdminEmptyState from '../ui/feedback/AdminEmptyState.vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import AdminRefreshBtn from '../ui/feedback/AdminRefreshBtn.vue';
import MfaPromptDialog from '../ui/overlay/MfaPromptDialog.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import { type ResourceOverride, useResource } from '../vue/resource-registry.js';
import type { PillTone } from '../vue/status.js';
import { useFeatureWithdrawalAnnouncement } from '../vue/use-feature-withdrawal-announcement.js';
import { useFeatureWithdrawals } from '../vue/use-feature-withdrawals.js';
import { useMfaPrompt } from '../vue/use-mfa-prompt.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';

// Platform standard page: features withdrawn for a reason outside the
// platform.
//
// What it answers is the operator's question when a service the product
// depends on stops, or a law takes a feature away: who loses it from when,
// what do they pay less, and have they been told? Withdrawing and lifting each
// change what every subscription holding the feature is granted and charged,
// so both ask for the second factor (`SC-SUB-042`).

const props = defineProps<{
    /**
     * Override the resources for this page only — the withdrawals, and the
     * catalogue that names the features. Layered over the app's own override;
     * see AP3 §3.2.
     */
    resources?: {
        featureWithdrawals?: ResourceOverride<(typeof featureWithdrawalsResource)['ops']>;
        catalog?: ResourceOverride<(typeof catalogResource)['ops']>;
    };
}>();

const STATUS_TONE: Readonly<Record<FeatureWithdrawalStatus, PillTone>> = {
    announced: 'info',
    inEffect: 'warning',
    lifted: 'muted',
};

const msg = useSaMessages('featureWithdrawals');
const { intlLocale } = useSuperAdminI18n();
const mfa = useMfaPrompt();
const withdrawals = useResource('featureWithdrawals', props.resources?.featureWithdrawals);
const { rows, loading, error, reload, lift } = useFeatureWithdrawals(withdrawals, mfa);
const announcement = useFeatureWithdrawalAnnouncement({
    withdrawals,
    catalog: useResource('catalog', props.resources?.catalog),
    mfa,
    onAnnounced: reload,
});

const liftOpen = ref(false);
const liftRow = ref<FeatureWithdrawalView | null>(null);

function openLift(id: string): void {
    liftRow.value = rows.value.find((row) => row.id === id) ?? null;
    liftOpen.value = liftRow.value !== null;
}

const tableRows = computed(() => {
    const now = new Date();
    // The resource checks the shape; a resource an application put in its place
    // may not, and a list that is not one must not take the route down.
    return (Array.isArray(rows.value) ? rows.value : []).map((row) => ({
        id: row.id,
        feature: `${row.featureLabel} (${row.featureKey})`,
        reason: row.reason,
        effectiveFrom: formatMoment(row.effectiveFrom, intlLocale.value),
        liftedFrom: formatMoment(row.liftedFrom, intlLocale.value),
        status: featureWithdrawalStatusOf(row, now),
        progress: formatMessage(msg.value.progress, { ...row.progress }),
        canLift: canLiftFeatureWithdrawal(row),
    }));
});

const columns = computed(() => [
    { name: 'feature', label: msg.value.columns.feature, field: 'feature', align: 'left' as const },
    { name: 'reason', label: msg.value.columns.reason, field: 'reason', align: 'left' as const },
    {
        name: 'effectiveFrom',
        label: msg.value.columns.effectiveFrom,
        field: 'effectiveFrom',
        align: 'left' as const,
    },
    {
        name: 'liftedFrom',
        label: msg.value.columns.liftedFrom,
        field: 'liftedFrom',
        align: 'left' as const,
    },
    { name: 'status', label: msg.value.columns.status, field: 'status', align: 'left' as const },
    {
        name: 'progress',
        label: msg.value.columns.progress,
        field: 'progress',
        align: 'left' as const,
    },
]);
</script>

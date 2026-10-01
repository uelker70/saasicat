<template>
    <AdminStatistics :columns="4">
        <AdminKpi :label="msg.kpis.activeVersion" :sub="activeVersionSub">
            <template #value>
                <template v-if="onSaleVersion">
                    v{{ onSaleVersion.version }}
                    <span class="chip live dot">{{ common.versionSale.onSale }}</span>
                </template>
                <template v-else>—</template>
            </template>
        </AdminKpi>

        <AdminKpi
            :label="msg.kpis.tenantImpact"
            :value="tenantTotal"
            :sub="msg.kpis.tenantsOnPlan"
        />

        <AdminKpi :label="msg.kpis.versions" :value="versionCount" :sub="versionsSummary" />

        <AdminKpi
            :label="msg.kpis.openDraft"
            :value="draftVersion ? `v${draftVersion.version}` : null"
            :sub="draftVersion ? msg.kpis.readyToEdit : msg.kpis.noOpenDraft"
            :tone="draftVersion ? 'warn' : 'neutral'"
            emphasis="surface"
        />
    </AdminStatistics>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import AdminKpi from '../../../ui/data/AdminKpi.vue';
import AdminStatistics from '../../../ui/data/AdminStatistics.vue';
import type { PlanVersionRow } from '@saasicat/core';
import { formatDay, formatMessage } from '../../../client/i18n/format.js';
import { useSaMessages, useSuperAdminI18n } from '../../../vue/use-super-admin-i18n.js';

const props = defineProps<{
    /** The version on sale now. */
    onSaleVersion: PlanVersionRow | null;
    draftVersion: PlanVersionRow | null;
    tenantTotal: number;
    versionCount: number;
    publishedCount: number;
}>();

const msg = useSaMessages('planDetail');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();

const activeVersionSub = computed(() => {
    const validFrom = props.onSaleVersion?.validFrom;
    return validFrom
        ? formatMessage(msg.value.kpis.activeSince, {
              date: formatDay(validFrom, intlLocale.value),
          })
        : msg.value.kpis.noPublishedVersion;
});

const versionsSummary = computed(() =>
    props.draftVersion
        ? formatMessage(msg.value.kpis.versionsSummaryWithDrafts, {
              published: props.publishedCount,
              drafts: 1,
          })
        : formatMessage(msg.value.kpis.versionsSummary, { published: props.publishedCount }),
);
</script>

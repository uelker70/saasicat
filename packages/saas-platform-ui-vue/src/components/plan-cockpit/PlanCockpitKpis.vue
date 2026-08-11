<template>
    <AdminStatistics :columns="4">
        <AdminKpi :label="msg.kpis.activeVersion" :sub="activeVersionSub">
            <template #value>
                <template v-if="liveVersion">
                    v{{ liveVersion.version }}
                    <span class="pc-chip pc-chip--live pc-chip--dot pc-chip--mid">live</span>
                </template>
                <template v-else>—</template>
            </template>
        </AdminKpi>

        <AdminKpi
            :label="msg.kpis.tenantImpact"
            :value="tenantImpactTotal"
            :sub="msg.kpis.tenantsOnPlan"
        />

        <AdminKpi :label="msg.kpis.versions" :value="versionsCount" :sub="versionsSummary" />

        <!-- Der Draft-Zustand war zuvor per inline `color:#b45309` gesetzt und
             damit gegen jedes Theming immun; jetzt trägt ihn der Ton. -->
        <AdminKpi
            :label="draftVersion ? msg.kpis.openDraft : msg.kpis.noDraft"
            :value="draftVersion ? `v${draftVersion.version}` : null"
            :sub="draftVersion ? msg.kpis.readyToEdit : msg.kpis.createNewDraft"
            :tone="draftVersion ? 'warn' : 'neutral'"
            emphasis="surface"
        />
    </AdminStatistics>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import AdminKpi from '../admin-page/AdminKpi.vue';
import AdminStatistics from '../admin-page/AdminStatistics.vue';
import type { PlanVersionRow } from '@saasicat/types';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{
    liveVersion: PlanVersionRow | null;
    tenantImpactTotal: number;
    versionsCount: number;
    publishedCount: number;
    draftCount: number;
    draftVersion: PlanVersionRow | null;
}>();

const msg = useSaMessages('planDetail');

const activeVersionSub = computed(() => {
    const validFrom = props.liveVersion?.validFrom;
    return validFrom
        ? formatMessage(msg.value.kpis.activeSince, { date: validFrom.slice(0, 10) })
        : msg.value.kpis.noPublishedVersion;
});

const versionsSummary = computed(() =>
    formatMessage(msg.value.kpis.versionsSummaryWithDrafts, {
        published: props.publishedCount,
        drafts: props.draftCount,
    }),
);
</script>

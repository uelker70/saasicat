<template>
    <AdminStatistics :columns="5">
        <AdminKpi :label="msg.kpi.featuresTotal" :value="featuresCount" :sub="featuresTotalSub" />
        <AdminKpi
            :label="msg.kpi.approved"
            :value="approvedCount"
            :sub="msg.kpi.approvedSub"
            tone="positive"
        />
        <AdminKpi
            :label="msg.kpi.pending"
            :value="pendingCount"
            :sub="msg.kpi.pendingSub"
            :tone="pendingCount > 0 ? 'warn' : 'neutral'"
            emphasis="surface"
        />
        <AdminKpi
            :label="msg.kpi.outdated"
            :value="outdatedCount + obsoleteCount"
            :sub="outdatedSub"
        />
        <AdminKpi
            :label="msg.kpi.orphans"
            :value="orphanCount"
            :sub="msg.orphansTitle"
            :tone="orphanCount > 0 ? 'danger' : 'neutral'"
            emphasis="surface"
        />
    </AdminStatistics>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import AdminKpi from '../../components/admin-page/AdminKpi.vue';
import AdminStatistics from '../../components/admin-page/AdminStatistics.vue';

import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

// Feature-centric KPI bar (#20 Slice 1, sim layout): the approval
// counts refer to features, no longer to capability reviews.
const props = defineProps<{
    featuresCount: number;
    capabilitiesCount: number;
    approvedCount: number;
    pendingCount: number;
    outdatedCount: number;
    obsoleteCount: number;
    orphanCount: number;
}>();

const msg = useSaMessages('discovery');

const featuresTotalSub = computed(() =>
    formatMessage(msg.value.kpi.featuresTotalSub, { count: props.capabilitiesCount }),
);
const outdatedSub = computed(() =>
    formatMessage(msg.value.kpi.outdatedSub, {
        outdated: props.outdatedCount,
        obsolete: props.obsoleteCount,
    }),
);
</script>

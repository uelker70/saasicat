<template>
    <div class="sa-discovery__kpis">
        <div class="sa-discovery__kpi">
            <div class="sa-discovery__kpi-label">{{ msg.kpi.featuresTotal }}</div>
            <div class="sa-discovery__kpi-value">{{ featuresCount }}</div>
            <div class="sa-discovery__kpi-sub">{{ featuresTotalSub }}</div>
        </div>
        <div class="sa-discovery__kpi good">
            <div class="sa-discovery__kpi-label">{{ msg.kpi.approved }}</div>
            <div class="sa-discovery__kpi-value">{{ approvedCount }}</div>
            <div class="sa-discovery__kpi-sub">{{ msg.kpi.approvedSub }}</div>
        </div>
        <div class="sa-discovery__kpi" :class="{ warn: pendingCount > 0 }">
            <div class="sa-discovery__kpi-label">{{ msg.kpi.pending }}</div>
            <div class="sa-discovery__kpi-value">{{ pendingCount }}</div>
            <div class="sa-discovery__kpi-sub">{{ msg.kpi.pendingSub }}</div>
        </div>
        <div class="sa-discovery__kpi">
            <div class="sa-discovery__kpi-label">{{ msg.kpi.outdated }}</div>
            <div class="sa-discovery__kpi-value">{{ outdatedCount + obsoleteCount }}</div>
            <div class="sa-discovery__kpi-sub">{{ outdatedSub }}</div>
        </div>
        <div class="sa-discovery__kpi" :class="{ bad: orphanCount > 0 }">
            <div class="sa-discovery__kpi-label">{{ msg.kpi.orphans }}</div>
            <div class="sa-discovery__kpi-value">{{ orphanCount }}</div>
            <div class="sa-discovery__kpi-sub">{{ msg.orphansTitle }}</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

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

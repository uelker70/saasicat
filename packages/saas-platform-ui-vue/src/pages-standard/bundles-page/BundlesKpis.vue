<template>
    <div class="sa-bundles__kpis">
        <div class="sa-bundles__kpi">
            <div class="sa-bundles__kpi-label">{{ msg.kpis.total }}</div>
            <div class="sa-bundles__kpi-value">{{ bundlesTotal }}</div>
            <div class="sa-bundles__kpi-sub">{{ totalSub }}</div>
        </div>
        <div class="sa-bundles__kpi">
            <div class="sa-bundles__kpi-label">{{ msg.kpis.scheduled }}</div>
            <div class="sa-bundles__kpi-value">{{ totalScheduledVersions }}</div>
            <div class="sa-bundles__kpi-sub">{{ msg.kpis.scheduledSub }}</div>
        </div>
        <div class="sa-bundles__kpi">
            <div class="sa-bundles__kpi-label">{{ msg.kpis.drafts }}</div>
            <div class="sa-bundles__kpi-value">{{ totalDraftVersions }}</div>
            <div class="sa-bundles__kpi-sub">{{ draftsSub }}</div>
        </div>
        <div class="sa-bundles__kpi">
            <div class="sa-bundles__kpi-label">{{ msg.kpis.translated }}</div>
            <div class="sa-bundles__kpi-value">{{ translatedCount }}</div>
            <div class="sa-bundles__kpi-sub">{{ translatedSub }}</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

const props = defineProps<{
    bundlesTotal: number;
    liveCount: number;
    scheduledBundlesCount: number;
    totalScheduledVersions: number;
    totalDraftVersions: number;
    draftBundlesCount: number;
    translatedCount: number;
    localesCount: number;
}>();

const msg = useSaMessages('bundles');

const totalSub = computed(() =>
    formatMessage(msg.value.kpis.totalSub, {
        live: props.liveCount,
        scheduled: props.scheduledBundlesCount,
    }),
);
const draftsSub = computed(() =>
    formatMessage(msg.value.kpis.draftsSub, { count: props.draftBundlesCount }),
);
const translatedSub = computed(() =>
    formatMessage(msg.value.kpis.translatedSub, { count: props.localesCount }),
);
</script>

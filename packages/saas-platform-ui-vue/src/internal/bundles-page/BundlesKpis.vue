<template>
    <AdminStatistics :columns="4">
        <AdminKpi :label="msg.kpis.total" :value="bundlesTotal" :sub="totalSub" />
        <AdminKpi
            :label="msg.kpis.scheduled"
            :value="totalScheduledVersions"
            :sub="msg.kpis.scheduledSub"
        />
        <AdminKpi :label="msg.kpis.drafts" :value="totalDraftVersions" :sub="draftsSub" />
        <AdminKpi :label="msg.kpis.translated" :value="translatedCount" :sub="translatedSub" />
    </AdminStatistics>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import AdminKpi from '../../ui/data/AdminKpi.vue';
import AdminStatistics from '../../ui/data/AdminStatistics.vue';

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

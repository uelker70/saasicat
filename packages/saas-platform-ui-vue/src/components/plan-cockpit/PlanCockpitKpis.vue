<template>
    <div class="pc-kpis">
        <div class="pc-kpi">
            <div class="pc-kpi-label">{{ msg.kpis.activeVersion }}</div>
            <div class="pc-kpi-val">
                <template v-if="liveVersion">
                    v{{ liveVersion.version }}
                    <span class="pc-chip pc-chip--live pc-chip--dot pc-chip--mid">live</span>
                </template>
                <template v-else>—</template>
            </div>
            <div class="pc-kpi-sub">{{ activeVersionSub }}</div>
        </div>
        <div class="pc-kpi">
            <div class="pc-kpi-label">{{ msg.kpis.tenantImpact }}</div>
            <div class="pc-kpi-val">{{ tenantImpactTotal }}</div>
            <div class="pc-kpi-sub">{{ msg.kpis.tenantsOnPlan }}</div>
        </div>
        <div class="pc-kpi">
            <div class="pc-kpi-label">{{ msg.kpis.versions }}</div>
            <div class="pc-kpi-val">{{ versionsCount }}</div>
            <div class="pc-kpi-sub">{{ versionsSummary }}</div>
        </div>
        <div :class="['pc-kpi', draftVersion ? 'pc-kpi--draft' : '']">
            <div class="pc-kpi-label" :style="draftVersion ? 'color:#b45309' : ''">
                {{ draftVersion ? msg.kpis.openDraft : msg.kpis.noDraft }}
            </div>
            <div class="pc-kpi-val">
                {{ draftVersion ? `v${draftVersion.version}` : '—' }}
            </div>
            <div class="pc-kpi-sub" :style="draftVersion ? 'color:#b45309' : ''">
                {{ draftVersion ? msg.kpis.readyToEdit : msg.kpis.createNewDraft }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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

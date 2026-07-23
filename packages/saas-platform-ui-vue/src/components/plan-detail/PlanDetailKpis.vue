<template>
    <div class="pd-kpis">
        <div class="pd-kpi">
            <div class="pd-kpi-label">{{ msg.kpis.activeVersion }}</div>
            <div class="pd-kpi-big">
                <template v-if="liveVersion">
                    v{{ liveVersion.version }}
                    <span class="chip live dot">live</span>
                </template>
                <template v-else>—</template>
            </div>
            <div class="pd-kpi-sub">{{ activeVersionSub }}</div>
        </div>

        <div class="pd-kpi">
            <div class="pd-kpi-label">{{ msg.kpis.tenantImpact }}</div>
            <div class="pd-kpi-big">{{ tenantTotal }}</div>
            <div class="pd-kpi-sub">{{ msg.kpis.tenantsOnPlan }}</div>
        </div>

        <div class="pd-kpi">
            <div class="pd-kpi-label">{{ msg.kpis.versions }}</div>
            <div class="pd-kpi-big">{{ versionCount }}</div>
            <div class="pd-kpi-sub">{{ versionsSummary }}</div>
        </div>

        <div :class="['pd-kpi', draftVersion ? 'draft' : '']">
            <div class="pd-kpi-label">{{ msg.kpis.openDraft }}</div>
            <div class="pd-kpi-big" :style="draftVersion ? '' : 'color:#cbd5e1'">
                {{ draftVersion ? `v${draftVersion.version}` : '—' }}
            </div>
            <div class="pd-kpi-sub">
                {{ draftVersion ? msg.kpis.readyToEdit : msg.kpis.noOpenDraft }}
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
    draftVersion: PlanVersionRow | null;
    tenantTotal: number;
    versionCount: number;
    publishedCount: number;
}>();

const msg = useSaMessages('planDetail');

const activeVersionSub = computed(() => {
    const validFrom = props.liveVersion?.validFrom;
    return validFrom
        ? formatMessage(msg.value.kpis.activeSince, { date: validFrom.slice(0, 10) })
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

<template>
    <div class="pc-kpis">
        <div class="pc-kpi">
            <div class="pc-kpi-label">Aktive Version</div>
            <div class="pc-kpi-val">
                <template v-if="liveVersion">
                    v{{ liveVersion.version }}
                    <span class="pc-chip pc-chip--live pc-chip--dot pc-chip--mid">live</span>
                </template>
                <template v-else>—</template>
            </div>
            <div class="pc-kpi-sub">
                {{
                    liveVersion?.validFrom
                        ? `seit ${liveVersion.validFrom.slice(0, 10)}`
                        : 'keine veröffentlichte Version'
                }}
            </div>
        </div>
        <div class="pc-kpi">
            <div class="pc-kpi-label">Tenant-Impact</div>
            <div class="pc-kpi-val">{{ tenantImpactTotal }}</div>
            <div class="pc-kpi-sub">Mandanten auf diesem Plan</div>
        </div>
        <div class="pc-kpi">
            <div class="pc-kpi-label">Versionen</div>
            <div class="pc-kpi-val">{{ versionsCount }}</div>
            <div class="pc-kpi-sub">
                {{ publishedCount }} live/superseded · {{ draftCount }} Draft
            </div>
        </div>
        <div :class="['pc-kpi', draftVersion ? 'pc-kpi--draft' : '']">
            <div class="pc-kpi-label" :style="draftVersion ? 'color:#b45309' : ''">
                {{ draftVersion ? 'Offener Draft' : 'Kein Draft' }}
            </div>
            <div class="pc-kpi-val">
                {{ draftVersion ? `v${draftVersion.version}` : '—' }}
            </div>
            <div class="pc-kpi-sub" :style="draftVersion ? 'color:#b45309' : ''">
                {{ draftVersion ? 'Bereit zum Bearbeiten' : 'Neue Draft anlegen' }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { PlanVersionRow } from '@saasicat/types';

defineProps<{
    liveVersion: PlanVersionRow | null;
    tenantImpactTotal: number;
    versionsCount: number;
    publishedCount: number;
    draftCount: number;
    draftVersion: PlanVersionRow | null;
}>();
</script>

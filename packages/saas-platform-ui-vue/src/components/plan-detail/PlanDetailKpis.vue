<template>
    <div class="pd-kpis">
        <div class="pd-kpi">
            <div class="pd-kpi-label">Aktive Version</div>
            <div class="pd-kpi-big">
                <template v-if="liveVersion">
                    v{{ liveVersion.version }}
                    <span class="chip live dot">live</span>
                </template>
                <template v-else>—</template>
            </div>
            <div class="pd-kpi-sub">
                {{
                    liveVersion?.validFrom
                        ? `seit ${liveVersion.validFrom.slice(0, 10)}`
                        : 'keine veröffentlichte Version'
                }}
            </div>
        </div>

        <div class="pd-kpi">
            <div class="pd-kpi-label">Tenant-Impact</div>
            <div class="pd-kpi-big">{{ tenantTotal }}</div>
            <div class="pd-kpi-sub">Mandanten auf diesem Plan</div>
        </div>

        <div class="pd-kpi">
            <div class="pd-kpi-label">Versionen</div>
            <div class="pd-kpi-big">{{ versionCount }}</div>
            <div class="pd-kpi-sub">
                {{ publishedCount }} live/superseded{{ draftVersion ? ' · 1 Draft' : '' }}
            </div>
        </div>

        <div :class="['pd-kpi', draftVersion ? 'draft' : '']">
            <div class="pd-kpi-label">Offener Draft</div>
            <div class="pd-kpi-big" :style="draftVersion ? '' : 'color:#cbd5e1'">
                {{ draftVersion ? `v${draftVersion.version}` : '—' }}
            </div>
            <div class="pd-kpi-sub">
                {{ draftVersion ? 'Bereit zum Bearbeiten' : 'Keine Draft-Version offen' }}
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { PlanVersionRow } from '@saasicat/types';

defineProps<{
    liveVersion: PlanVersionRow | null;
    draftVersion: PlanVersionRow | null;
    tenantTotal: number;
    versionCount: number;
    publishedCount: number;
}>();
</script>

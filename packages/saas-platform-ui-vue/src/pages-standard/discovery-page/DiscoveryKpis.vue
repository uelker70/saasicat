<template>
    <div class="sa-discovery__kpis">
        <div class="sa-discovery__kpi">
            <div class="sa-discovery__kpi-label">Features gesamt</div>
            <div class="sa-discovery__kpi-value">{{ featuresCount }}</div>
            <div class="sa-discovery__kpi-sub">
                aggregiert aus {{ capabilitiesCount }} Capabilities
            </div>
        </div>
        <div class="sa-discovery__kpi good">
            <div class="sa-discovery__kpi-label">Freigegeben</div>
            <div class="sa-discovery__kpi-value">{{ approvedCount }}</div>
            <div class="sa-discovery__kpi-sub">planungsbereit</div>
        </div>
        <div class="sa-discovery__kpi" :class="{ warn: pendingCount > 0 }">
            <div class="sa-discovery__kpi-label">Ausstehend</div>
            <div class="sa-discovery__kpi-value">{{ pendingCount }}</div>
            <div class="sa-discovery__kpi-sub">noch nicht freigegeben</div>
        </div>
        <div class="sa-discovery__kpi">
            <div class="sa-discovery__kpi-label">Veraltet / Obsolet</div>
            <div class="sa-discovery__kpi-value">{{ outdatedCount + obsoleteCount }}</div>
            <div class="sa-discovery__kpi-sub">
                {{ outdatedCount }} outdated · {{ obsoleteCount }} obsolete
            </div>
        </div>
        <div class="sa-discovery__kpi" :class="{ bad: orphanCount > 0 }">
            <div class="sa-discovery__kpi-label">Orphans</div>
            <div class="sa-discovery__kpi-value">{{ orphanCount }}</div>
            <div class="sa-discovery__kpi-sub">Capabilities ohne Feature</div>
        </div>
    </div>
</template>

<script setup lang="ts">
// Feature-centric KPI bar (#20 Slice 1, sim layout): the approval
// counts refer to features, no longer to capability reviews.
defineProps<{
    featuresCount: number;
    capabilitiesCount: number;
    approvedCount: number;
    pendingCount: number;
    outdatedCount: number;
    obsoleteCount: number;
    orphanCount: number;
}>();
</script>

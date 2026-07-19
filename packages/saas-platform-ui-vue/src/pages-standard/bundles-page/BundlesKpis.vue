<template>
    <div class="sa-bundles__kpis">
        <div class="sa-bundles__kpi">
            <div class="sa-bundles__kpi-label">Bundles gesamt</div>
            <div class="sa-bundles__kpi-value">{{ bundlesTotal }}</div>
            <div class="sa-bundles__kpi-sub">
                {{ liveCount }} live · {{ scheduledBundlesCount }} mit geplanter Version
            </div>
        </div>
        <div class="sa-bundles__kpi">
            <div class="sa-bundles__kpi-label">Geplante Versionen</div>
            <div class="sa-bundles__kpi-value">{{ totalScheduledVersions }}</div>
            <div class="sa-bundles__kpi-sub">zukünftig aktiv · noch nicht verkaufbar</div>
        </div>
        <div class="sa-bundles__kpi">
            <div class="sa-bundles__kpi-label">Offene Drafts</div>
            <div class="sa-bundles__kpi-value">{{ totalDraftVersions }}</div>
            <div class="sa-bundles__kpi-sub">{{ draftBundlesCount }} Bundle(s) ohne Publish</div>
        </div>
        <div class="sa-bundles__kpi">
            <div class="sa-bundles__kpi-label">Mit Übersetzung</div>
            <div class="sa-bundles__kpi-value">{{ translatedCount }}</div>
            <div class="sa-bundles__kpi-sub">{{ localesCount }} aktive Sprache(n) im Projekt</div>
        </div>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    bundlesTotal: number;
    liveCount: number;
    scheduledBundlesCount: number;
    totalScheduledVersions: number;
    totalDraftVersions: number;
    draftBundlesCount: number;
    translatedCount: number;
    localesCount: number;
}>();
</script>

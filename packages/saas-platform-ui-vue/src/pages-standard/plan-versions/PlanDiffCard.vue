<template>
    <div v-if="changes.length === 0" class="sa-pv-diff-card sa-pv-diff-card--noop">
        <div class="sa-pv-diff-card__noop-icon"><q-icon name="check" size="14px" /></div>
        <div>
            <div class="sa-pv-diff-card__name">
                {{ title }}
                <span v-if="versionNew" class="sa-pv-diff-card__ver">v{{ versionNew }}</span>
            </div>
            <div class="sa-pv-diff-card__sub">Keine Änderungen</div>
        </div>
    </div>
    <div v-else class="sa-pv-diff-card">
        <header class="sa-pv-diff-card__head">
            <span
                class="sa-pv-diff-card__accent"
                :style="{ background: `${accent}14`, borderColor: `${accent}40` }"
            >
                <q-icon name="inventory_2" size="14px" :style="{ color: accent }" />
            </span>
            <span class="sa-pv-diff-card__name">{{ title }}</span>
            <span v-if="versionOld != null && versionNew != null" class="sa-pv-diff-card__ver">
                v{{ versionOld }} → v{{ versionNew }}
            </span>
            <span v-else-if="versionNew != null" class="sa-pv-diff-card__ver"
                >+ v{{ versionNew }}</span
            >
            <span v-else-if="versionOld != null" class="sa-pv-diff-card__ver"
                >− v{{ versionOld }}</span
            >
            <span class="sa-pv-diff-card__count">
                {{ changes.length }} Änderung{{ changes.length !== 1 ? 'en' : '' }}
            </span>
        </header>
        <div class="sa-pv-diff-card__body">
            <VersionDiffPreview :changes="changes" :field-labels="fieldLabels" />
        </div>
    </div>
</template>

<script setup lang="ts">
import type { VersionChange } from '@saasicat/types';
import VersionDiffPreview from './VersionDiffPreview.vue';

defineProps<{
    title: string;
    versionOld: number | null;
    versionNew: number | null;
    accent: string;
    changes: VersionChange[];
    fieldLabels?: Record<string, string>;
}>();
</script>

<style scoped>
.sa-pv-diff-card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 10px;
    margin-bottom: 12px;
    overflow: hidden;
}
.sa-pv-diff-card--noop {
    padding: 12px 16px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
    opacity: 0.65;
}
.sa-pv-diff-card__noop-icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: var(--sa-positive-soft, rgba(4, 120, 87, 0.1));
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-pv-diff-card__noop-icon :deep(.q-icon) {
    color: var(--sa-positive, #047857);
}

.sa-pv-diff-card__head {
    padding: 12px 16px;
    border-bottom: 1px solid var(--sa-border-soft, #f1f5f9);
    display: flex;
    align-items: center;
    gap: 12px;
    background: #fafbfc;
}
.sa-pv-diff-card__accent {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    border: 1px solid;
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-pv-diff-card__name {
    font-weight: 700;
    font-size: 14px;
    color: var(--sa-heading, #0f172a);
    font-family: var(--sa-font-head, system-ui, sans-serif);
}
.sa-pv-diff-card__ver {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    font-size: 11px;
    font-weight: 600;
    color: var(--sa-muted, #64748b);
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 4px;
}
.sa-pv-diff-card__sub {
    font-size: 11.5px;
    color: var(--sa-muted, #64748b);
}
.sa-pv-diff-card__count {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    background: var(--sa-warning-soft, rgba(245, 158, 11, 0.1));
    color: var(--sa-warning, #b45309);
    padding: 2px 8px;
    border-radius: 4px;
    margin-left: auto;
}
.sa-pv-diff-card__body {
    padding: 12px 16px;
}
</style>

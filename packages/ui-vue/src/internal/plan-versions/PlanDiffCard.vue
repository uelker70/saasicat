<template>
    <div v-if="changes.length === 0" class="sa-pv-diff-card sa-pv-diff-card--noop">
        <div class="sa-pv-diff-card__noop-icon"><q-icon name="check" size="14px" /></div>
        <div>
            <div class="sa-pv-diff-card__name">
                {{ title }}
                <span v-if="versionNew" class="sa-pv-diff-card__ver">v{{ versionNew }}</span>
            </div>
            <div class="sa-pv-diff-card__sub">{{ common.noChanges }}</div>
        </div>
    </div>
    <div v-else class="sa-pv-diff-card">
        <header class="sa-pv-diff-card__head">
            <span class="sa-pv-diff-card__accent" :style="accentWashStyle">
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
            <span class="sa-pv-diff-card__count">{{ changeCountLabel }}</span>
        </header>
        <div class="sa-pv-diff-card__body">
            <VersionDiffPreview :changes="changes" :field-labels="fieldLabels" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VersionChange } from '@saasicat/core';
import { identityChipStyle } from '../../client/identity-accents.js';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import VersionDiffPreview from '../../features/bundle/VersionDiffPreview.vue';

const props = defineProps<{
    title: string;
    versionOld: number | null;
    versionNew: number | null;
    accent: string;
    changes: VersionChange[];
    fieldLabels?: Record<string, string>;
}>();

const msg = useSaMessages('planVersions');

// The wash and the edge this badge always had — deliberately not the chip
// helper's third property. `identityChipStyle` also sets a text colour, and
// the icon inside already sets its own; no fixture renders this card, so a
// change nobody can observe is a change nobody should make.
const accentWashStyle = computed(() => {
    const { background, borderColor } = identityChipStyle(props.accent);
    return { background, borderColor };
});
const common = useSaMessages('common');

const changeCountLabel = computed(() => {
    const count = props.changes.length;
    const template = count === 1 ? msg.value.diff.changeCountOne : msg.value.diff.changeCountMany;
    return formatMessage(template, { count });
});
</script>

<style scoped>
.sa-pv-diff-card {
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
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
    background: var(--sa-color-positive-surface);
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-pv-diff-card__noop-icon :deep(.q-icon) {
    color: var(--sa-color-positive-fg);
}

.sa-pv-diff-card__head {
    padding: 12px 16px;
    border-bottom: 1px solid var(--sa-color-border-soft);
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--sa-color-bg-surface-raised);
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
    font-size: var(--sa-text-lg);
    color: var(--sa-color-fg-heading);
    font-family: var(--sa-font-head, system-ui, sans-serif);
}
.sa-pv-diff-card__ver {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    font-size: var(--sa-text-xs);
    font-weight: 600;
    color: var(--sa-color-fg-muted);
    background: var(--sa-color-border-soft);
    padding: 2px 6px;
    border-radius: 4px;
}
.sa-pv-diff-card__sub {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
}
.sa-pv-diff-card__count {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    background: var(--sa-color-warning-surface-strong);
    color: var(--sa-color-warning-fg);
    padding: 2px 8px;
    border-radius: 4px;
    margin-left: auto;
}
.sa-pv-diff-card__body {
    padding: 12px 16px;
}
</style>

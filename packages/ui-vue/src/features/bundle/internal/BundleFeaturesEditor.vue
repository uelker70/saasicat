<template>
    <div :class="['bd-features', { 'bd-locked': locked }]">
        <template v-for="group in groupedFeatures" :key="group.key">
            <div class="bd-features-group">
                <div class="bd-features-group-label">{{ group.label }}</div>
                <div class="bd-features-row">
                    <!-- @optionSurface
                         A selectable feature pill: it carries a tick and a state, and reads as a
                         checkbox rather than as a button. -->
                    <button
                        v-for="f in group.rows"
                        :key="f.featureKey"
                        type="button"
                        class="bd-feature-pill"
                        :class="{
                            on: features.includes(f.featureKey),
                            overlap: overlapKeys.includes(f.featureKey),
                        }"
                        :disabled="locked"
                        :title="pillTitle(f.featureKey)"
                        @click="onToggle(f.featureKey)"
                    >
                        <span class="bd-feature-tick" aria-hidden="true">
                            <q-icon
                                v-if="features.includes(f.featureKey)"
                                name="check"
                                size="11px"
                            />
                            <q-icon v-else name="add" size="11px" />
                        </span>
                        <span class="bd-feature-label">{{ featureLabel(f.featureKey) }}</span>
                        <span class="bd-feature-key">{{ f.featureKey }}</span>
                    </button>
                </div>
            </div>
        </template>
        <div v-if="groupedFeatures.length === 0" class="bd-features-empty">
            {{ msg.featuresEditor.empty }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DiscoveredFeature } from '@saasicat/core';
import { useSaMessages, useSuperAdminI18n } from '../../../vue/use-super-admin-i18n.js';

// BundleFeaturesEditor — grouped pills for the feature selection of a
// bundle version (after plan simulation). The source of truth for the
// library is the discovery snapshot; the `featureRegistry` mapping from
// the wrapper provides only the label to display + the group bucket
// (analogous to `PlanVersionEditor`).
//
// `locked` = live/superseded version → the pills are disabled
// (contract protection; UI mirrors the backend rule `isVersionEditable`).
// `overlapKeys` = features already contained in a compatible plan
// → are marked as an "overlap" (warn about double billing).

export interface FeatureMeta {
    /** Display name; fallback = featureKey. */
    label?: string;
    /** Library bucket (e.g. "Communication", "Finance"). Default "General". */
    group?: string;
}

const props = defineProps<{
    /** Library = discovery snapshot features. */
    availableFeatures: DiscoveredFeature[];
    /** Currently selected feature keys on the version. */
    features: string[];
    /** Switch to read-only (live/superseded). */
    locked?: boolean;
    /** Display mapping per feature key. */
    featureRegistry?: Record<string, FeatureMeta>;
    /** Features already contained in a selected compatible plan. */
    overlapKeys?: string[];
}>();

const msg = useSaMessages('bundles');
const common = useSaMessages('common');
const { intlLocale } = useSuperAdminI18n();

const emit = defineEmits<{
    (e: 'toggle', featureKey: string): void;
}>();

function featureLabel(key: string): string {
    return props.featureRegistry?.[key]?.label ?? key;
}

function featureGroup(key: string): string {
    return props.featureRegistry?.[key]?.group ?? common.value.general;
}

function pillTitle(key: string): string {
    if (props.locked) return msg.value.compatPicker.lockedTooltip;
    if (props.overlapKeys?.includes(key)) {
        return msg.value.featuresEditor.overlapTooltip;
    }
    return props.features.includes(key)
        ? msg.value.featuresEditor.removeTooltip
        : msg.value.featuresEditor.addTooltip;
}

const overlapKeys = computed(() => props.overlapKeys ?? []);

const groupedFeatures = computed(() => {
    const byGroup = new Map<string, DiscoveredFeature[]>();
    for (const f of props.availableFeatures) {
        const g = featureGroup(f.featureKey);
        const list = byGroup.get(g) ?? [];
        list.push(f);
        byGroup.set(g, list);
    }
    return [...byGroup.entries()]
        .sort(([a], [b]) => a.localeCompare(b, intlLocale.value))
        .map(([key, rows]) => ({ key, label: key, rows }));
});

function onToggle(featureKey: string): void {
    if (props.locked) return;
    emit('toggle', featureKey);
}
</script>

<style scoped>
.bd-features {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-4);
}
.bd-features.bd-locked {
    opacity: 0.7;
}
.bd-features-group {
    display: flex;
    flex-direction: column;
    gap: var(--sa-space-2);
}
.bd-features-group-label {
    font-size: var(--sa-text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--sa-tracking-wider);
    color: var(--sa-color-fg-muted);
}
.bd-features-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sa-space-2);
}
.bd-feature-pill {
    display: inline-flex;
    align-items: center;
    gap: var(--sa-space-2);
    padding: var(--sa-space-2) var(--sa-space-3);
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
    border-radius: var(--sa-radius-pill);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-heading);
    transition:
        background 0.12s,
        border-color 0.12s,
        color 0.12s;
}
.bd-feature-pill:hover:not(:disabled) {
    background: var(--sa-color-bg-sunken);
    border-color: var(--sa-color-border-strong);
}
.bd-feature-pill.on {
    background: var(--sa-color-info-surface-strong);
    border-color: var(--sa-color-info-border);
    color: var(--sa-color-info-fg);
}
.bd-feature-pill.overlap {
    border-color: var(--sa-color-negative-border);
    background: var(--sa-color-negative-surface);
    color: var(--sa-color-negative-fg);
}
.bd-feature-pill:disabled {
    cursor: not-allowed;
}
.bd-feature-tick {
    display: inline-flex;
}
.bd-feature-key {
    font:
        600 var(--sa-text-2xs) 'JetBrains Mono',
        ui-monospace,
        monospace;
    color: var(--sa-color-fg-subtle);
    margin-left: var(--sa-space-2);
}
.bd-feature-pill.on .bd-feature-key {
    /* `-strong`, not the bare accent: the pill's `on` surface is a 24 % tint of
     * blue over the dark card, and the brand does not change between themes —
     * 2.92:1 there. The selected states around this one were moved to
     * `-strong` already; this descendant was missed because it sets a colour
     * and no background, which is a shape no contrast check reads. */
    color: var(--sa-color-accent-strong);
}
.bd-feature-pill.overlap .bd-feature-key {
    color: var(--sa-color-negative-fg);
}
.bd-features-empty {
    padding: var(--sa-space-4);
    color: var(--sa-color-fg-subtle);
    font-style: italic;
    font-size: var(--sa-text-md);
}
</style>

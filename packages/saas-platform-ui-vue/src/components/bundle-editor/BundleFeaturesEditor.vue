<template>
    <div :class="['bd-features', { 'bd-locked': locked }]">
        <template v-for="group in groupedFeatures" :key="group.key">
            <div class="bd-features-group">
                <div class="bd-features-group-label">{{ group.label }}</div>
                <div class="bd-features-row">
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
                            <svg
                                v-if="features.includes(f.featureKey)"
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="3"
                            >
                                <path d="M5 13l4 4L19 7" />
                            </svg>
                            <svg
                                v-else
                                width="11"
                                height="11"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                        </span>
                        <span class="bd-feature-label">{{ featureLabel(f.featureKey) }}</span>
                        <span class="bd-feature-key">{{ f.featureKey }}</span>
                    </button>
                </div>
            </div>
        </template>
        <div v-if="groupedFeatures.length === 0" class="bd-features-empty">
            Keine Features im Discovery-Snapshot.
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DiscoveredFeature } from '@saasicat/types';

// BundleFeaturesEditor — gruppierte Pills für die Feature-Auswahl einer
// Bundle-Version (nach Plan-Simulation). Source-of-Truth für die
// Library ist der Discovery-Snapshot; das `featureRegistry`-Mapping aus
// dem Wrapper liefert nur das anzuzeigende Label + den Gruppen-Bucket
// (analog `PlanVersionEditor`).
//
// `locked` = Live-/Superseded-Version → die Pills sind disabled
// (Vertragsschutz; UI spiegelt die Backend-Regel `isVersionEditable`).
// `overlapKeys` = Features, die in einem kompatiblen Plan schon enthalten
// sind → werden als „Doppelpunkt" markiert (Doppel-Berechnung warnen).

export interface FeatureMeta {
    /** Anzeigename; Fallback = featureKey. */
    label?: string;
    /** Library-Bucket (z. B. „Communication", „Finance"). Default „Allgemein". */
    group?: string;
}

const props = defineProps<{
    /** Library = Discovery-Snapshot-Features. */
    availableFeatures: DiscoveredFeature[];
    /** Aktuell selektierte Feature-Keys auf der Version. */
    features: string[];
    /** Read-only schalten (live/superseded). */
    locked?: boolean;
    /** Display-Mapping pro Feature-Key. */
    featureRegistry?: Record<string, FeatureMeta>;
    /** Features, die in einem ausgewählten kompatiblen Plan schon enthalten sind. */
    overlapKeys?: string[];
}>();

const emit = defineEmits<{
    (e: 'toggle', featureKey: string): void;
}>();

function featureLabel(key: string): string {
    return props.featureRegistry?.[key]?.label ?? key;
}

function featureGroup(key: string): string {
    return props.featureRegistry?.[key]?.group ?? 'Allgemein';
}

function pillTitle(key: string): string {
    if (props.locked) return 'Live-Version ist read-only';
    if (props.overlapKeys?.includes(key)) {
        return 'Feature ist im kompatiblen Plan bereits enthalten — Doppel-Berechnung';
    }
    return props.features.includes(key) ? 'Aus Bundle entfernen' : 'In Bundle aufnehmen';
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
        .sort(([a], [b]) => a.localeCompare(b, 'de-DE'))
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
    gap: 12px;
}
.bd-features.bd-locked {
    opacity: 0.7;
}
.bd-features-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.bd-features-group-label {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
}
.bd-features-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.bd-feature-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
    color: #0f172a;
    transition:
        background 0.12s,
        border-color 0.12s,
        color 0.12s;
}
.bd-feature-pill:hover:not(:disabled) {
    background: #f8fafc;
    border-color: #cbd5e1;
}
.bd-feature-pill.on {
    background: #dbeafe;
    border-color: #93c5fd;
    color: #1e40af;
}
.bd-feature-pill.overlap {
    border-color: #fecaca;
    background: #fef2f2;
    color: #b91c1c;
}
.bd-feature-pill:disabled {
    cursor: not-allowed;
}
.bd-feature-tick {
    display: inline-flex;
}
.bd-feature-key {
    font:
        600 10px 'JetBrains Mono',
        ui-monospace,
        monospace;
    color: #94a3b8;
    margin-left: 4px;
}
.bd-feature-pill.on .bd-feature-key {
    color: #2563eb;
}
.bd-feature-pill.overlap .bd-feature-key {
    color: #b91c1c;
}
.bd-features-empty {
    padding: 12px;
    color: #94a3b8;
    font-style: italic;
    font-size: 12.5px;
}
</style>

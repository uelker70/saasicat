<template>
    <div class="bv-compat">
        <div class="bv-compat-hint">
            Pläne, mit denen dieses Bundle als Add-On gebucht werden kann. Features/Quotas, die der
            Plan bereits enthält, werden als Überschneidung markiert (Doppel-Berechnung).
        </div>
        <div class="bv-compat-grid">
            <button
                v-for="entry in entries"
                :key="entry.plan.planKey"
                type="button"
                class="bv-compat-card"
                :class="{
                    on: selectedKeys.includes(entry.plan.planKey),
                    warn: showOverlap(entry),
                }"
                :disabled="locked"
                :title="
                    locked
                        ? 'Live-Version ist read-only'
                        : selectedKeys.includes(entry.plan.planKey)
                          ? 'Plan-Kompatibilität entfernen'
                          : 'Plan-Kompatibilität setzen'
                "
                @click="onToggle(entry.plan.planKey)"
            >
                <div class="bv-compat-head">
                    <span class="bv-compat-mark">{{ entry.plan.planKey.slice(0, 3) }}</span>
                    <div class="bv-compat-body">
                        <div class="bv-compat-name">{{ entry.plan.label }}</div>
                        <div class="bv-compat-key">{{ entry.plan.planKey }}</div>
                    </div>
                    <span
                        v-if="selectedKeys.includes(entry.plan.planKey)"
                        class="bv-compat-check"
                        aria-hidden="true"
                    >
                        <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="3"
                        >
                            <path d="M5 13l4 4L19 7" />
                        </svg>
                    </span>
                </div>
                <div v-if="showOverlap(entry)" class="bv-compat-overlap">
                    <div class="bv-compat-overlap-head">⚠ Überschneidung</div>
                    <div v-if="entry.overlap.features.length > 0" class="bv-compat-overlap-list">
                        <span class="bv-compat-overlap-kind">Features:</span>
                        <span
                            v-for="fk in entry.overlap.features"
                            :key="fk"
                            class="bv-compat-overlap-chip"
                        >
                            {{ featureLabel(fk) }}
                        </span>
                    </div>
                    <div v-if="entry.overlap.quotas.length > 0" class="bv-compat-overlap-list">
                        <span class="bv-compat-overlap-kind">Quotas:</span>
                        <span
                            v-for="qk in entry.overlap.quotas"
                            :key="qk"
                            class="bv-compat-overlap-chip"
                        >
                            {{ quotaLabel(qk) }}
                        </span>
                    </div>
                </div>
            </button>
            <div v-if="plans.length === 0" class="bv-compat-empty">
                Keine Pläne vorhanden — der Plan-Stamm muss zuerst angelegt werden.
            </div>
        </div>
        <div v-if="overlapCount > 0" class="bv-compat-summary">
            <span class="bv-compat-summary-ico">⚠</span>
            <span>
                <b>{{ overlapCount }}</b> Plan{{ overlapCount === 1 ? '' : 'e' }} mit Überschneidung
                — Features/Quotas dieses Bundles sind im Plan bereits enthalten. Vor Publish
                entweder das Bundle oder den Plan bereinigen.
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DiscoveredQuota, PlanRow, PlanVersionRow } from '@saasicat/types';

import { findBundlePlanOverlap, type BundlePlanOverlap } from './bundle-version-status';

import type { FeatureMeta } from './BundleFeaturesEditor.vue';
import type { QuotaMeta } from './catalog-i18n.js';

// BundlePlanCompatPicker — Mehrfachauswahl der Pläne, mit denen dieses
// Bundle als Add-On gebucht werden darf (Plan-Bundle-Sichtbarkeit, nach
// Plan-Simulation). Für jeden selektierten Plan wird live die
// Feature-/Quota-Überschneidung berechnet und als Warnung dargestellt.
//
// Hinweis P11.7.4: die Selektion wird heute auf
// `BundleVersionRow.compatibility` persistiert (Feld existiert im Type)
// — eine dedizierte `bundle_plans`-Junction kommt in einer eigenen
// Phase.

interface CompatEntry {
    plan: PlanRow;
    overlap: BundlePlanOverlap;
}

const props = defineProps<{
    /** Plan-Stämme aus dem Konsumenten-Wrapper. */
    plans: PlanRow[];
    /** Live (oder latest) PlanVersion pro planKey — Overlap-Quelle. */
    livePlanVersions?: Record<string, PlanVersionRow | null>;
    /** Features/Quotas der aktuellen BundleVersion (für Overlap-Berechnung). */
    bundleFeatures: string[];
    bundleQuotas: Record<string, number>;
    /** Aktuell ausgewählte Plan-Keys. */
    selectedKeys: string[];
    locked?: boolean;
    /** Für Overlap-Chip-Labels. */
    featureRegistry?: Record<string, FeatureMeta>;
    availableQuotas?: DiscoveredQuota[];
    /** In der Anzeige-Locale aufgelöste Quota-Labels (aus dem Quota-Catalog). */
    quotaRegistry?: Record<string, QuotaMeta>;
}>();

const emit = defineEmits<{
    (e: 'toggle', planKey: string): void;
}>();

const entries = computed<CompatEntry[]>(() =>
    props.plans.map((plan) => ({
        plan,
        overlap: findBundlePlanOverlap(
            { features: props.bundleFeatures, quotas: props.bundleQuotas },
            props.livePlanVersions?.[plan.planKey] ?? null,
        ),
    })),
);

const overlapCount = computed(
    () =>
        entries.value.filter((e) => props.selectedKeys.includes(e.plan.planKey) && e.overlap.hasAny)
            .length,
);

function showOverlap(entry: CompatEntry): boolean {
    return props.selectedKeys.includes(entry.plan.planKey) && entry.overlap.hasAny;
}

function featureLabel(key: string): string {
    return props.featureRegistry?.[key]?.label ?? key;
}

function quotaLabel(key: string): string {
    return (
        props.quotaRegistry?.[key]?.label ??
        props.availableQuotas?.find((q) => q.quotaKey === key)?.label ??
        key
    );
}

function onToggle(planKey: string): void {
    if (props.locked) return;
    emit('toggle', planKey);
}
</script>

<style scoped>
.bv-compat {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.bv-compat-hint {
    font-size: 11.5px;
    color: #64748b;
    line-height: 1.5;
}
.bv-compat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 8px;
}
.bv-compat-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    color: #0f172a;
    transition:
        background 0.12s,
        border-color 0.12s;
}
.bv-compat-card:hover:not(:disabled) {
    background: #f8fafc;
}
.bv-compat-card.on {
    border-color: #2563eb;
    background: #eff6ff;
}
.bv-compat-card.warn {
    border-color: #fca5a5;
    background: #fef2f2;
}
.bv-compat-card:disabled {
    cursor: not-allowed;
    opacity: 0.7;
}
.bv-compat-head {
    display: flex;
    align-items: center;
    gap: 10px;
}
.bv-compat-mark {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    background: #e0e7ff;
    color: #4338ca;
    border: 1px solid #c7d2fe;
    border-radius: 6px;
    font:
        700 9px 'JetBrains Mono',
        ui-monospace,
        monospace;
    letter-spacing: 0.04em;
    flex: 0 0 auto;
}
.bv-compat-body {
    flex: 1;
    min-width: 0;
}
.bv-compat-name {
    font-size: 13px;
    font-weight: 600;
}
.bv-compat-key {
    font:
        500 11px 'JetBrains Mono',
        ui-monospace,
        monospace;
    color: #64748b;
}
.bv-compat-check {
    color: #2563eb;
    display: inline-flex;
}
.bv-compat-overlap {
    padding: 6px 8px;
    background: #fff;
    border: 1px dashed #fecaca;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: #b91c1c;
}
.bv-compat-overlap-head {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
}
.bv-compat-overlap-list {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    font-size: 11.5px;
}
.bv-compat-overlap-kind {
    color: #7f1d1d;
    font-weight: 600;
}
.bv-compat-overlap-chip {
    padding: 1px 6px;
    border: 1px solid #fecaca;
    border-radius: 4px;
    background: #fff;
    color: #b91c1c;
}
.bv-compat-empty {
    padding: 12px;
    color: #94a3b8;
    font-style: italic;
    font-size: 12.5px;
    text-align: center;
}
.bv-compat-summary {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #b91c1c;
    font-size: 12.5px;
    line-height: 1.5;
}
.bv-compat-summary-ico {
    font-weight: 700;
}
</style>

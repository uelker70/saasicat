<template>
    <section class="pd-panel">
        <div class="pd-panel-head">
            <div style="min-width: 0">
                <h3 class="pd-panel-title">
                    <template v-if="predecessor">
                        Diff v{{ predecessor.version }} → v{{ selectedVersion?.version }}
                    </template>
                    <template v-else>Komponenten · v{{ selectedVersion?.version }}</template>
                </h3>
                <div class="pd-panel-sub">
                    <template v-if="predecessor && selectedVersion">
                        {{
                            statusOf(selectedVersion) === 'draft'
                                ? 'Was sich beim Publish ändert'
                                : `Änderungen v${predecessor.version} → v${selectedVersion.version}`
                        }}
                    </template>
                    <template v-else>Initialversion · kein Vorgänger zum Vergleich</template>
                </div>
            </div>
            <div class="pd-panel-head-right pd-diff-chips">
                <template v-if="predecessor">
                    <span class="pd-diff-chip add">+{{ diff.featuresAdded.length }} F</span>
                    <span class="pd-diff-chip rm">−{{ diff.featuresRemoved.length }} F</span>
                    <span class="pd-diff-chip mod">{{ quotaChangeCount }} Q</span>
                </template>
                <template v-else-if="selectedVersion">
                    <span class="pd-diff-chip add">{{ selectedVersion.features.length }} F</span>
                    <span class="pd-diff-chip mod">{{ quotaCount(selectedVersion) }} Q</span>
                </template>
            </div>
        </div>

        <div v-if="predecessor" class="pd-diff-list">
            <div v-for="d in diffRows" :key="d.id" :class="['pd-diff-row', d.kind]">
                <div class="pd-diff-icon">{{ d.sign }}</div>
                <div class="pd-diff-body">
                    <span class="pd-diff-kind">
                        {{
                            d.kind === 'add'
                                ? 'Hinzugefügt'
                                : d.kind === 'rm'
                                  ? 'Entfernt'
                                  : 'Geändert'
                        }}
                    </span>
                    <span class="pd-diff-label">{{ d.label }}</span>
                    <code class="pd-diff-key">{{ d.key }}</code>
                    <span v-if="d.from !== undefined" class="pd-diff-vals">
                        <span class="pd-diff-strike">{{ d.from }}</span>
                        <span class="pd-diff-arrow">→</span>
                        <span class="pd-diff-new">{{ d.to }}</span>
                    </span>
                    <span :class="['pd-diff-tag', d.kind]">{{ d.tag }}</span>
                </div>
            </div>
            <div v-if="diffRows.length === 0" class="pd-diff-empty">
                <b>Keine Änderungen</b>
                v{{ selectedVersion?.version }} ist identisch zu v{{ predecessor.version }}.
            </div>
        </div>

        <div v-else-if="selectedVersion" class="pd-diff-list">
            <div
                v-if="selectedVersion.features.length === 0 && quotaCount(selectedVersion) === 0"
                class="pd-diff-empty"
            >
                <b>Keine Komponenten</b>
                Diese Version enthält weder Features noch Quotas.
            </div>
            <template v-if="selectedVersion.features.length > 0">
                <div class="pd-diff-section">
                    <hr />
                    <span>Features · {{ selectedVersion.features.length }}</span>
                    <hr />
                </div>
                <div
                    v-for="f in [...selectedVersion.features].sort()"
                    :key="'ahp-' + f"
                    class="pd-diff-row plain"
                >
                    <div class="pd-diff-icon" style="background: #8b5cf6">·</div>
                    <div class="pd-diff-body">
                        <span class="pd-diff-label">{{ featureLabel(f) }}</span>
                        <code class="pd-diff-key">{{ f }}</code>
                    </div>
                </div>
            </template>
            <template v-if="quotaCount(selectedVersion) > 0">
                <div class="pd-diff-section">
                    <hr />
                    <span>Quotas · {{ quotaCount(selectedVersion) }}</span>
                    <hr />
                </div>
                <div
                    v-for="[k, val] in Object.entries(quotasOf(selectedVersion)).sort()"
                    :key="'cq-' + k"
                    class="pd-diff-row plain"
                >
                    <div class="pd-diff-icon" style="background: #0ea5e9">·</div>
                    <div class="pd-diff-body">
                        <span class="pd-diff-label">{{ quotaLabel(k) }}</span>
                        <code class="pd-diff-key">{{ k }}</code>
                        <span class="pd-diff-tag mod">{{ val }} {{ quotaUnit(k) }}</span>
                    </div>
                </div>
            </template>
            <template v-if="(selectedVersion.bundles ?? []).length > 0">
                <div class="pd-diff-section">
                    <hr />
                    <span>Bundles · {{ (selectedVersion.bundles ?? []).length }}</span>
                    <hr />
                </div>
                <div
                    v-for="b in [...(selectedVersion.bundles ?? [])].sort()"
                    :key="'cb-' + b"
                    class="pd-diff-row plain"
                >
                    <div class="pd-diff-icon" style="background: #f59e0b">·</div>
                    <div class="pd-diff-body">
                        <span class="pd-diff-label">{{ bundleLabel(b) }}</span>
                        <code class="pd-diff-key">{{ b }}</code>
                    </div>
                </div>
            </template>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { PlanVersionRow } from '@saasicat/types';
import type { DiffRow, PlanVersionDiff, StatusOf } from './types.js';

defineProps<{
    selectedVersion: PlanVersionRow | null;
    predecessor: PlanVersionRow | null;
    diff: PlanVersionDiff;
    diffRows: DiffRow[];
    quotaChangeCount: number;
    statusOf: StatusOf;
    quotaCount: (version: PlanVersionRow) => number;
    quotasOf: (version: PlanVersionRow) => Record<string, number>;
    featureLabel: (key: string) => string;
    quotaLabel: (key: string) => string;
    quotaUnit: (key: string) => string;
    bundleLabel: (key: string) => string;
}>();
</script>

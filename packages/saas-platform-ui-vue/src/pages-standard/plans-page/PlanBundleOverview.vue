<template>
    <section class="sa-bundles">
        <div class="sa-bundles__head">
            <h2 class="sa-bundles__title">Bundles</h2>
            <span class="sa-bundles__count">{{ bundles.length }}</span>
        </div>

        <div v-if="bundles.length === 0" class="sa-bundles__empty">
            Keine Bundles vorhanden.
        </div>

        <div v-else class="sa-bundles__grid">
            <q-card v-for="bundle in bundles" :key="bundle.bundleKey" flat bordered class="sa-bundle">
                <q-card-section class="sa-bundle__header">
                    <div class="sa-bundle__label">{{ bundle.label ?? bundle.bundleKey }}</div>
                    <div class="sa-bundle__key">{{ bundle.bundleKey }}</div>
                </q-card-section>
                <q-separator />
                <q-card-section>
                    <div class="sa-bundle__caption">Enthält</div>
                    <div class="sa-bundle__chips">
                        <q-chip
                            v-for="feature in bundle.features"
                            :key="feature"
                            dense
                            square
                            size="sm"
                            class="sa-bundle__chip"
                        >
                            {{ featureLabel(feature) }}
                        </q-chip>
                        <span v-if="bundle.features.length === 0" class="sa-bundle__muted">—</span>
                    </div>
                </q-card-section>
                <q-card-section class="sa-bundle__compat">
                    <div class="sa-bundle__caption">Kompatibel mit</div>
                    <div class="sa-bundle__plans">{{ compatLabel(bundle) }}</div>
                </q-card-section>
            </q-card>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { PlanRow } from '@saasicat/types';

interface BundleEntry {
    bundleKey: string;
    label?: string | null;
    features: string[];
    compatiblePlanKeys?: string[] | null;
}

const props = defineProps<{
    bundles: BundleEntry[];
    plans: PlanRow[];
    featureRegistry: Record<string, { label?: string; group?: string }>;
}>();

function featureLabel(featureKey: string): string {
    return props.featureRegistry[featureKey]?.label ?? featureKey;
}

function planLabel(planKey: string): string {
    return props.plans.find((p) => p.planKey === planKey)?.label ?? planKey;
}

// Empty compatibility list = bundle applies to all plans (cf. PlanMatrix.hasBundle).
function compatLabel(bundle: BundleEntry): string {
    const keys = bundle.compatiblePlanKeys ?? [];
    if (keys.length === 0) return 'Alle Pläne';
    return keys.map(planLabel).join(', ');
}
</script>

<style scoped>
.sa-bundles {
    padding: 8px 16px 32px;
}
.sa-bundles__head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0 12px;
}
.sa-bundles__title {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
    color: #0f172a;
}
.sa-bundles__count {
    font-size: 12px;
    color: #64748b;
    background: #e2e8f0;
    border-radius: 999px;
    padding: 1px 8px;
}
.sa-bundles__empty {
    color: #64748b;
    font-size: 14px;
    padding: 8px 0;
}
.sa-bundles__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
}
.sa-bundle__header {
    padding-bottom: 8px;
}
.sa-bundle__label {
    font-weight: 600;
    color: #0f172a;
}
.sa-bundle__key {
    font-size: 11px;
    color: #94a3b8;
    font-family: monospace;
}
.sa-bundle__caption {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #94a3b8;
    margin-bottom: 4px;
}
.sa-bundle__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.sa-bundle__chip {
    background: #eef2ff;
    color: #3730a3;
}
.sa-bundle__muted {
    color: #94a3b8;
}
.sa-bundle__compat {
    padding-top: 0;
}
.sa-bundle__plans {
    font-size: 13px;
    color: #334155;
}
</style>

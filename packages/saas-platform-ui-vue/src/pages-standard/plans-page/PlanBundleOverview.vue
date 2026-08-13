<template>
    <AdminSection :title="msg.bundleOverview.title">
        <template #actions>
            <span class="sa-bundles__count">{{ bundles.length }}</span>
        </template>

        <div v-if="bundles.length === 0" class="sa-bundle-overview__empty">
            {{ msg.bundleOverview.empty }}
        </div>

        <div v-else class="sa-bundles__grid">
            <q-card
                v-for="bundle in bundles"
                :key="bundle.bundleKey"
                flat
                bordered
                class="sa-bundle"
            >
                <q-card-section class="sa-bundle__header">
                    <div class="sa-bundle__label">{{ bundle.label ?? bundle.bundleKey }}</div>
                    <div class="sa-bundle__key">{{ bundle.bundleKey }}</div>
                </q-card-section>
                <q-separator />
                <q-card-section>
                    <div class="sa-bundle__caption">{{ msg.bundleOverview.contains }}</div>
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
                    <div class="sa-bundle__caption">{{ msg.bundleOverview.compatibleWith }}</div>
                    <div class="sa-bundle__plans">{{ compatLabel(bundle) }}</div>
                </q-card-section>
            </q-card>
        </div>
    </AdminSection>
</template>

<script setup lang="ts">
import type { PlanRow } from '@saasicat/types';
import AdminSection from '../../components/admin-page/AdminSection.vue';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';

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

const msg = useSaMessages('plans');

function featureLabel(featureKey: string): string {
    return props.featureRegistry[featureKey]?.label ?? featureKey;
}

function planLabel(planKey: string): string {
    return props.plans.find((p) => p.planKey === planKey)?.label ?? planKey;
}

// Empty compatibility list = bundle applies to all plans (cf. PlanMatrix.hasBundle).
function compatLabel(bundle: BundleEntry): string {
    const keys = bundle.compatiblePlanKeys ?? [];
    if (keys.length === 0) return msg.value.bundleOverview.allPlans;
    return keys.map(planLabel).join(', ');
}
</script>

<style scoped>
.sa-bundle {
    display: flex;
    flex-direction: column;
    gap: 0;
    background-color: var(--sa-color-bg-surface);
}
.sa-bundles__count {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
    background: var(--sa-color-border);
    border-radius: 999px;
    padding: 1px 8px;
}
.sa-bundle-overview__empty {
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-lg);
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
    color: var(--sa-color-fg-heading);
}
.sa-bundle__key {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
    font-family: monospace;
}
.sa-bundle__caption {
    font-size: var(--sa-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--sa-color-fg-subtle);
    margin-bottom: 4px;
}
.sa-bundle__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.sa-bundle__chip {
    background: var(--sa-color-scheduled-surface);
    color: var(--sa-color-scheduled-fg);
}
.sa-bundle__muted {
    color: var(--sa-color-fg-subtle);
}
.sa-bundle__compat {
    padding-top: 0;
}
.sa-bundle__plans {
    font-size: var(--sa-text-md);
    color: var(--sa-color-fg-body);
}
</style>

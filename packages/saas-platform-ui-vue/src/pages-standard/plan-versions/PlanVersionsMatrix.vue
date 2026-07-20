<template>
    <div class="sa-pv-matrix">
        <div class="sa-pv-matrix__card">
            <div class="sa-pv-matrix__head" :style="gridStyle">
                <div class="sa-pv-matrix__th">Feature</div>
                <div v-for="plan in snapshot.plans" :key="plan.planId" class="sa-pv-matrix__plan">
                    <div class="sa-pv-matrix__plan-name">{{ plan.planId }}</div>
                    <div class="sa-pv-matrix__plan-price">
                        {{ fmtEuro(plan.monthlyNet) }}/Mo · v{{ plan.version }}
                    </div>
                </div>
            </div>

            <template v-for="grp in groupsWithItems" :key="grp.name">
                <div v-if="grp.name" class="sa-pv-matrix__group">{{ grp.name }}</div>
                <div
                    v-for="f in grp.items"
                    :key="f.key"
                    class="sa-pv-matrix__row"
                    :style="gridStyle"
                >
                    <div class="sa-pv-matrix__feat-cell">
                        <div class="sa-pv-matrix__feat-icon">
                            <q-icon :name="f.icon" size="14px" />
                        </div>
                        <div>
                            <div class="sa-pv-matrix__feat-label">
                                {{ f.label }}
                                <span v-if="f.plannedOnly" class="sa-pv-matrix__planned"
                                    >PLANNED</span
                                >
                            </div>
                            <div class="sa-pv-matrix__feat-key">{{ f.key }}</div>
                        </div>
                    </div>
                    <div
                        v-for="plan in snapshot.plans"
                        :key="plan.planId"
                        class="sa-pv-matrix__cell"
                        :class="{ 'sa-pv-matrix__cell--off': !plan.features.includes(f.key) }"
                    >
                        <span v-if="plan.features.includes(f.key)" class="sa-pv-matrix__check">
                            <q-icon name="check" size="14px" />
                        </span>
                        <span v-else class="sa-pv-matrix__dash" aria-hidden="true" />
                    </div>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { CatalogSnapshot } from '../../plan-versions-catalog.js';
import { fmtEuro } from './format.js';

// Generische Feature-Matrix. Apps reichen `featureRegistry` für Label/Icon/
// PlannedOnly-Hint und optional `featureGroups` für die UX-Gruppierung der
// Reihen (z. B. Kern, Rechnung, Daten, …).
//
// Ohne `featureGroups` rendert die Matrix eine einzige Gruppe ohne Header.

interface FeatureMeta {
    label?: string;
    icon?: string;
    plannedOnly?: boolean;
}

interface FeatureGroupsConfig {
    /** Reihenfolge der Gruppen-Header. */
    order: readonly string[];
    /** Map FeatureKey → Gruppen-Name. Unzugeordnete Features landen in „Sonstige". */
    byKey: Record<string, string>;
    /** Default-Bucket für Features ohne `byKey`-Eintrag. Default: 'Sonstige'. */
    fallbackGroup?: string;
}

const props = defineProps<{
    snapshot: CatalogSnapshot;
    featureRegistry: Record<string, FeatureMeta>;
    featureGroups?: FeatureGroupsConfig;
}>();

const gridStyle = computed(() => ({
    gridTemplateColumns: `minmax(280px, 1.5fr) repeat(${props.snapshot.plans.length}, minmax(110px, 1fr))`,
}));

interface MatrixFeature {
    key: string;
    label: string;
    icon: string;
    plannedOnly: boolean;
}

const groupsWithItems = computed<Array<{ name: string | null; items: MatrixFeature[] }>>(() => {
    const allItems: MatrixFeature[] = Object.entries(props.featureRegistry).map(([key, meta]) => ({
        key,
        label: meta.label ?? key,
        icon: meta.icon ?? 'extension',
        plannedOnly: meta.plannedOnly === true,
    }));

    if (!props.featureGroups) {
        return allItems.length > 0 ? [{ name: null, items: allItems }] : [];
    }

    const fallback = props.featureGroups.fallbackGroup ?? 'Sonstige';
    const byGroup = new Map<string, MatrixFeature[]>();
    for (const item of allItems) {
        const group = props.featureGroups.byKey[item.key] ?? fallback;
        const list = byGroup.get(group) ?? [];
        list.push(item);
        byGroup.set(group, list);
    }
    const orderWithFallback = [
        ...props.featureGroups.order,
        ...(byGroup.has(fallback) && !props.featureGroups.order.includes(fallback)
            ? [fallback]
            : []),
    ];
    return orderWithFallback.flatMap((g) => {
        const items = byGroup.get(g);
        return items && items.length > 0 ? [{ name: g, items }] : [];
    });
});
</script>

<style scoped>
.sa-pv-matrix {
    padding: 20px 28px;
}
.sa-pv-matrix__card {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
}

.sa-pv-matrix__head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: grid;
    background: #fafbfc;
    border-bottom: 1px solid var(--sa-border, #e2e8f0);
}
.sa-pv-matrix__th {
    padding: 12px 16px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
    border-right: 1px solid var(--sa-border, #e2e8f0);
}
.sa-pv-matrix__plan {
    padding: 12px 14px;
    text-align: center;
    border-right: 1px solid var(--sa-border, #e2e8f0);
}
.sa-pv-matrix__plan-name {
    font-size: 12.5px;
    font-weight: 700;
    color: var(--sa-heading, #0f172a);
    font-family: var(--sa-font-head, system-ui, sans-serif);
}
.sa-pv-matrix__plan-price {
    font-size: 10.5px;
    color: var(--sa-muted, #64748b);
    margin-top: 1px;
    font-family: var(--sa-font-mono, ui-monospace, monospace);
}

.sa-pv-matrix__group {
    padding: 8px 16px;
    background: var(--sa-border-soft, #f1f5f9);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
    border-bottom: 1px solid var(--sa-border, #e2e8f0);
}
.sa-pv-matrix__row {
    display: grid;
    border-bottom: 1px solid var(--sa-border-soft, #f1f5f9);
}

.sa-pv-matrix__feat-cell {
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-right: 1px solid var(--sa-border-soft, #f1f5f9);
}
.sa-pv-matrix__feat-icon {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: var(--sa-primary-soft, rgba(63, 107, 255, 0.08));
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.sa-pv-matrix__feat-icon :deep(.q-icon) {
    color: var(--sa-primary, #3f6bff);
}
.sa-pv-matrix__feat-label {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--sa-heading, #0f172a);
    display: flex;
    align-items: center;
    gap: 5px;
}
.sa-pv-matrix__planned {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    background: #fef3c7;
    color: #92400e;
    padding: 1px 5px;
    border-radius: 3px;
}
.sa-pv-matrix__feat-key {
    font-size: 10.5px;
    color: var(--sa-muted, #64748b);
    margin-top: 1px;
    font-family: var(--sa-font-mono, ui-monospace, monospace);
}

.sa-pv-matrix__cell {
    display: flex;
    align-items: center;
    justify-content: center;
    border-right: 1px solid var(--sa-border-soft, #f1f5f9);
}
.sa-pv-matrix__cell--off {
    background: #fafbfc;
}
.sa-pv-matrix__check {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--sa-positive-soft, rgba(4, 120, 87, 0.1));
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-pv-matrix__check :deep(.q-icon) {
    color: var(--sa-positive, #047857);
}
.sa-pv-matrix__dash {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px dashed var(--sa-border, #e2e8f0);
}
</style>

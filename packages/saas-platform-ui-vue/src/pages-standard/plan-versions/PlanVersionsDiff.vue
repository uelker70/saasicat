<template>
    <div class="sa-pv-diff">
        <div class="sa-pv-diff__overview">
            <div class="sa-pv-diff__hero">
                <q-icon name="compare_arrows" size="22px" color="white" />
            </div>
            <div>
                <div class="sa-pv-diff__legend">Vergleich</div>
                <div class="sa-pv-diff__title">
                    {{ from.label }} <span class="sa-pv-diff__sep">→</span> {{ to.label }}
                </div>
            </div>
            <div class="sa-pv-diff__spacer" />
            <div class="sa-pv-diff__stats">
                <div class="sa-pv-diff__stat">
                    <div class="sa-pv-diff__stat-label">Pakete geändert</div>
                    <div class="sa-pv-diff__stat-value sa-pv-diff__stat-value--warn">
                        {{ planChangedCount }}
                    </div>
                </div>
                <div v-if="regressionCount > 0" class="sa-pv-diff__stat">
                    <div class="sa-pv-diff__stat-label">Regressionen</div>
                    <div class="sa-pv-diff__stat-value sa-pv-diff__stat-value--bad">
                        {{ regressionCount }}
                    </div>
                </div>
            </div>
        </div>

        <h2 class="sa-pv-diff__section">Pakete</h2>
        <PlanDiffCard
            v-for="d in planDiffs"
            :key="d.id"
            :title="d.id"
            :version-old="d.versionOld"
            :version-new="d.versionNew"
            :accent="planAccent(d.id)"
            :changes="d.changes"
            :field-labels="fieldLabels"
        />

    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { VersionChange } from '@saasicat/types';
import type { CatalogSnapshot, ResolvedPlan } from '../../client/plan-versions-catalog.js';
import PlanDiffCard from './PlanDiffCard.vue';

interface SnapshotEntityDiff {
    id: string;
    versionOld: number | null;
    versionNew: number | null;
    changes: VersionChange[];
}

const props = defineProps<{
    from: CatalogSnapshot;
    to: CatalogSnapshot;
    /** Accent color per plan ID (for the diff card icons). */
    planAccents?: Record<string, string>;
    /** Field label overrides (e.g. `{ maxVehicles: 'Max. Fahrzeuge' }`). */
    fieldLabels?: Record<string, string>;
}>();

function planAccent(planId: string): string {
    return props.planAccents?.[planId] ?? '#3f6bff';
}

const planDiffs = computed<SnapshotEntityDiff[]>(() => {
    const out: SnapshotEntityDiff[] = [];
    const ids = uniqueIds(
        props.from.plans.map((p) => p.planId),
        props.to.plans.map((p) => p.planId),
    );
    for (const id of ids) {
        const a = props.from.plans.find((p) => p.planId === id) ?? null;
        const b = props.to.plans.find((p) => p.planId === id) ?? null;
        out.push({
            id,
            versionOld: a?.version ?? null,
            versionNew: b?.version ?? null,
            changes: diffPlan(a, b),
        });
    }
    return out;
});

const planChangedCount = computed(() => planDiffs.value.filter((d) => d.changes.length > 0).length);
const regressionCount = computed(() =>
    planDiffs.value.reduce(
        (sum, d) => sum + d.changes.filter((c) => c.direction === 'REGRESSION').length,
        0,
    ),
);

function uniqueIds(a: string[], b: string[]): string[] {
    return Array.from(new Set([...a, ...b]));
}

function diffPlan(a: ResolvedPlan | null, b: ResolvedPlan | null): VersionChange[] {
    if (!a && b)
        return [
            { field: 'plan.added', oldValue: null, newValue: b.planId, direction: 'IMPROVEMENT' },
        ];
    if (a && !b)
        return [
            { field: 'plan.removed', oldValue: a.planId, newValue: null, direction: 'REGRESSION' },
        ];
    if (!a || !b) return [];
    const out: VersionChange[] = [];
    pushFeatures(out, a.features, b.features);
    // Quotas: compare all known keys from both snapshots.
    const quotaKeys = new Set<string>([...Object.keys(a.quotas), ...Object.keys(b.quotas)]);
    for (const key of quotaKeys) {
        pushNumber(out, `quotas.${key}`, a.quotas[key] ?? 0, b.quotas[key] ?? 0, 'higher');
    }
    pushDecimal(out, 'monthlyNet', a.monthlyNet, b.monthlyNet, 'lower');
    pushDecimal(out, 'yearlyNet', a.yearlyNet, b.yearlyNet, 'lower');
    return out;
}

function pushFeatures(
    out: VersionChange[],
    oldF: readonly string[],
    newF: readonly string[],
): void {
    const oldSet = new Set(oldF);
    const newSet = new Set(newF);
    const removed = oldF.filter((f) => !newSet.has(f));
    const added = newF.filter((f) => !oldSet.has(f));
    if (removed.length > 0) {
        out.push({
            field: 'features.removed',
            oldValue: removed,
            newValue: [],
            direction: 'REGRESSION',
        });
    }
    if (added.length > 0) {
        out.push({
            field: 'features.added',
            oldValue: [],
            newValue: added,
            direction: 'IMPROVEMENT',
        });
    }
}

function pushNumber(
    out: VersionChange[],
    field: string,
    oldV: number,
    newV: number,
    polarity: 'higher' | 'lower',
): void {
    if (oldV === newV) return;
    out.push({
        field,
        oldValue: oldV,
        newValue: newV,
        direction: directionFor(newV - oldV, polarity),
    });
}

function pushDecimal(
    out: VersionChange[],
    field: string,
    oldV: number,
    newV: number,
    polarity: 'higher' | 'lower',
): void {
    if (oldV === newV) return;
    out.push({
        field,
        oldValue: oldV.toFixed(2),
        newValue: newV.toFixed(2),
        direction: directionFor(newV - oldV, polarity),
    });
}

function directionFor(delta: number, polarity: 'higher' | 'lower'): VersionChange['direction'] {
    if (delta === 0) return 'NEUTRAL';
    const positive = delta > 0;
    if (polarity === 'higher') return positive ? 'IMPROVEMENT' : 'REGRESSION';
    return positive ? 'REGRESSION' : 'IMPROVEMENT';
}
</script>

<style scoped>
.sa-pv-diff {
    padding: 20px 28px;
}
.sa-pv-diff__overview {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    padding: 16px 20px;
    margin-bottom: 18px;
    display: flex;
    align-items: center;
    gap: 18px;
}
.sa-pv-diff__hero {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    background: linear-gradient(135deg, #f59e0b, #d97706);
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-pv-diff__legend {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
}
.sa-pv-diff__title {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 18px;
    color: var(--sa-heading, #0f172a);
}
.sa-pv-diff__sep {
    color: var(--sa-muted, #64748b);
    font-weight: 500;
}
.sa-pv-diff__spacer {
    flex: 1;
}
.sa-pv-diff__stats {
    display: flex;
    gap: 14px;
}
.sa-pv-diff__stat {
    text-align: right;
}
.sa-pv-diff__stat-label {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
}
.sa-pv-diff__stat-value {
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-weight: 700;
    font-size: 22px;
}
.sa-pv-diff__stat-value--warn {
    color: var(--sa-warning, #b45309);
}
.sa-pv-diff__stat-value--bad {
    color: var(--sa-negative, #dc2626);
}

.sa-pv-diff__section {
    margin: 22px 0 10px;
    font-family: var(--sa-font-head, system-ui, sans-serif);
    font-size: 14px;
    font-weight: 700;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
</style>

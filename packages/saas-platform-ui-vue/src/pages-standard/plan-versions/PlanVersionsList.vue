<template>
    <div class="sa-pv-list">
        <div class="sa-pv-list__kpis">
            <PlanVersionsKpi label="Pakete" :value="snapshot.plans.length" icon="inventory_2" />
            <PlanVersionsKpi
                label="Self-Service"
                :value="marketedCount"
                icon="storefront"
                :sub="`von ${snapshot.plans.length}`"
            />
            <PlanVersionsKpi label="Features gesamt" :value="totalFeatures" icon="extension" />
        </div>

        <div v-if="missingPlans.length > 0" class="sa-pv-list__missing">
            <q-icon name="info" size="16px" />
            <div>
                <strong>Fehlende Pakete:</strong> {{ missingPlans.join(', ') }} — keine Live-Version
                in diesem Snapshot.
                <template v-if="canEdit">
                    <button
                        v-for="planId in missingPlans"
                        :key="`new-${planId}`"
                        type="button"
                        class="sa-pv-list__missing-btn"
                        @click="emit('createPlanDraft', planId)"
                    >
                        Draft für {{ planId }}
                    </button>
                </template>
            </div>
        </div>

        <div class="sa-pv-list__table">
            <slot name="table-head">
                <div
                    class="sa-pv-list__head sa-pv-list__row sa-pv-list__row--default"
                    :style="rowGridStyle"
                >
                    <div>Paket</div>
                    <div class="sa-pv-list__th--num">Preis (netto)</div>
                    <div
                        v-for="col in quotaColumns"
                        :key="`hd-${col.key}`"
                        class="sa-pv-list__th--num"
                    >
                        {{ col.label }}
                    </div>
                    <div class="sa-pv-list__th--num">Features</div>
                </div>
            </slot>

            <template v-for="(plan, i) in snapshot.plans" :key="plan.planId">
                <slot
                    name="row"
                    :plan="plan"
                    :is-open="openId === plan.planId"
                    :is-last="i === snapshot.plans.length - 1"
                    :can-edit="canEdit"
                    :toggle="() => onToggle(plan.planId)"
                >
                    <div
                        class="sa-pv-list__default-row sa-pv-list__row sa-pv-list__row--default"
                        :style="rowGridStyle"
                    >
                        <div class="sa-pv-list__default-name">
                            <strong>{{ plan.planId }}</strong>
                            <span class="sa-pv-list__default-version">v{{ plan.version }}</span>
                            <span v-if="plan.isDraft" class="sa-pv-list__default-chip">DRAFT</span>
                        </div>
                        <div class="sa-pv-list__th--num">
                            {{ formatEuro(plan.monthlyNet) }}
                        </div>
                        <div
                            v-for="col in quotaColumns"
                            :key="`val-${plan.planId}-${col.key}`"
                            class="sa-pv-list__th--num"
                        >
                            {{ formatQuotaValue(plan.quotas[col.key], col) }}
                        </div>
                        <div class="sa-pv-list__th--num">{{ plan.features.length }}</div>
                    </div>
                </slot>
            </template>
        </div>

        <div v-if="snapshot.kind === 'drafts'" class="sa-pv-list__draft-hint">
            <q-icon name="info" size="18px" />
            <div>
                <strong>Arbeitsstand:</strong> Drafts oben in der Liste. Limits, Preise und Features
                per Klick auf <em>„Bearbeiten"</em> ändern (ohne MFA). Erst
                <strong>Publish-Flow</strong> (Validate → Diff-Review → MFA → Apply) macht sie für
                künftige Renewals wirksam.
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CatalogSnapshot } from '../../plan-versions-catalog.js';
import PlanVersionsKpi from './PlanVersionsKpi.vue';
import { fmtEuro } from './format.js';

/**
 * Konfiguration einer Quota-Spalte (z. B. `users` → "Benutzer"). Optional
 * `fractional: true` → 1 Nachkommastelle (Storage-GB). Optional `unit` →
 * Suffix wie "GB" hinter dem Wert. `-1` wird als ∞ ausgegeben.
 */
export interface QuotaColumnConfig {
    key: string;
    label: string;
    fractional?: boolean;
    unit?: string;
}

const props = defineProps<{
    snapshot: CatalogSnapshot;
    /**
     * Optional: alle erwarteten Plan-IDs. Wenn gesetzt, zeigt die Liste eine
     * Warnung mit „Draft anlegen"-Buttons für fehlende Pläne.
     */
    expectedPlanIds?: readonly string[];
    /**
     * Optional: zusätzliche Quota-Spalten zwischen "Preis" und "Features".
     * Beispiel vereinsfux: `[{ key: 'users', label: 'Benutzer' },
     * { key: 'members', label: 'Mitglieder' }, { key: 'storageGb',
     * label: 'Speicher (GB)', fractional: true }, { key: 'resources',
     * label: 'Plätze' }]`. Default: keine zusätzlichen Spalten
     * (rückwärtskompatibel).
     */
    quotaColumns?: ReadonlyArray<QuotaColumnConfig>;
}>();

const emit = defineEmits<{
    (e: 'editPlanDraft', draftId: string): void;
    (e: 'createPlanDraft', planId: string): void;
}>();

const openId = ref<string | null>(null);
const canEdit = computed(() => props.snapshot.kind === 'drafts');

const marketedCount = computed(() => props.snapshot.plans.filter((p) => p.marketed).length);
const totalFeatures = computed(() => new Set(props.snapshot.plans.flatMap((p) => p.features)).size);

const missingPlans = computed<string[]>(() => {
    if (!props.expectedPlanIds) return [];
    const present = new Set(props.snapshot.plans.map((p) => p.planId));
    return props.expectedPlanIds.filter((id) => !present.has(id));
});

const quotaColumns = computed<ReadonlyArray<QuotaColumnConfig>>(() => props.quotaColumns ?? []);

const rowGridStyle = computed(() => {
    if (quotaColumns.value.length === 0) {
        return { gridTemplateColumns: '1.6fr 1fr 0.6fr' };
    }
    // Name (1.6fr), Preis (1fr), N×Quota (0.7fr), Features (0.5fr)
    const quotaCols = Array(quotaColumns.value.length).fill('0.7fr').join(' ');
    return { gridTemplateColumns: `1.6fr 1fr ${quotaCols} 0.5fr` };
});

function onToggle(id: string): void {
    openId.value = openId.value === id ? null : id;
}

function formatEuro(n: number): string {
    return fmtEuro(n);
}

function formatQuotaValue(value: number | undefined, col: QuotaColumnConfig): string {
    if (value === undefined) return '–';
    if (value === -1) return '∞';
    const formatted = col.fractional ? value.toFixed(1) : Math.round(value).toString();
    return col.unit ? `${formatted} ${col.unit}` : formatted;
}
</script>

<style scoped>
.sa-pv-list {
    padding: 20px 28px;
}
.sa-pv-list__kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 18px;
}
.sa-pv-list__missing {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: var(--sa-warning-soft, rgba(245, 158, 11, 0.1));
    border: 1px solid var(--sa-amber-border, rgba(245, 158, 11, 0.3));
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 14px;
    font-size: 12.5px;
    color: #7c2d12;
}
.sa-pv-list__missing :deep(.q-icon) {
    color: var(--sa-warning, #b45309);
}
.sa-pv-list__missing-btn {
    background: #fff;
    border: 1px solid var(--sa-amber-border, rgba(245, 158, 11, 0.3));
    color: var(--sa-warning, #b45309);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    margin-left: 6px;
}

.sa-pv-list__table {
    background: #fff;
    border: 1px solid var(--sa-border, #e2e8f0);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.sa-pv-list__row {
    display: grid;
    align-items: center;
    gap: 12px;
}
.sa-pv-list__row--default {
    grid-template-columns: 1.6fr 1fr 0.6fr;
    padding: 10px 14px;
}
.sa-pv-list__head {
    background: #fafbfc;
    border-bottom: 1px solid var(--sa-border, #e2e8f0);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--sa-muted, #64748b);
    text-transform: uppercase;
}
.sa-pv-list__th--num {
    text-align: right;
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    font-size: 13px;
}

.sa-pv-list__default-row {
    border-bottom: 1px solid var(--sa-border-soft, #f1f5f9);
}
.sa-pv-list__default-row:last-child {
    border-bottom: none;
}
.sa-pv-list__default-name {
    display: flex;
    align-items: center;
    gap: 8px;
}
.sa-pv-list__default-version {
    font-family: var(--sa-font-mono, ui-monospace, monospace);
    font-size: 11px;
    font-weight: 600;
    color: var(--sa-muted, #64748b);
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 4px;
}
.sa-pv-list__default-chip {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--sa-warning-soft, rgba(245, 158, 11, 0.1));
    color: var(--sa-warning, #b45309);
}

.sa-pv-list__draft-hint {
    margin-top: 14px;
    background: var(--sa-warning-soft, rgba(245, 158, 11, 0.1));
    border: 1px solid var(--sa-amber-border, rgba(245, 158, 11, 0.3));
    border-radius: 10px;
    padding: 12px 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    font-size: 12.5px;
    color: #7c2d12;
    line-height: 1.5;
}
.sa-pv-list__draft-hint :deep(.q-icon) {
    color: var(--sa-warning, #b45309);
}
</style>

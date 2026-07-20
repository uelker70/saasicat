<template>
    <div class="sa-pv">
        <div v-if="loading" class="sa-pv__loading">
            <q-spinner size="32px" /> Catalog wird geladen…
        </div>

        <template v-else>
            <PlanVersionsTimeline
                :snapshots="snapshots"
                :selected-id="selectedId"
                :compare-id="compareId"
                @select="onSelect"
                @set-compare="onSetCompare"
                @clear-compare="compareId = null"
            />

            <main class="sa-pv__main">
                <PlanVersionHeader
                    v-if="selected"
                    :snapshot="selected"
                    :view-mode="viewMode"
                    :compare-snapshot="compare"
                    @view-change="viewMode = $event"
                    @publish="emit('publish')"
                    @clear-compare="compareId = null"
                />

                <div class="sa-pv__body">
                    <template v-if="selected">
                        <PlanVersionsDiff
                            v-if="compare"
                            :from="compare"
                            :to="selected"
                            :plan-accents="planAccents"
                            :field-labels="diffFieldLabels"
                        />
                        <template v-else-if="viewMode === 'list'">
                            <slot name="list" :snapshot="selected">
                                <PlanVersionsList
                                    :snapshot="selected"
                                    :expected-plan-ids="expectedPlanIds"
                                    :quota-columns="quotaColumns"
                                    @edit-plan-draft="emit('editPlanDraft', $event)"
                                    @create-plan-draft="emit('createPlanDraft', $event)"
                                />
                            </slot>
                        </template>
                        <template v-else-if="viewMode === 'matrix'">
                            <slot name="matrix" :snapshot="selected">
                                <PlanVersionsMatrix
                                    :snapshot="selected"
                                    :feature-registry="featureRegistry ?? {}"
                                    :feature-groups="featureGroups"
                                />
                            </slot>
                        </template>
                        <template v-else>
                            <slot name="audit" :snapshot="selected">
                                <PlanVersionsAudit
                                    v-if="loadAudit"
                                    :snapshot="selected"
                                    :load-audit="loadAudit"
                                    :action-meta="auditActionMeta"
                                />
                                <div v-else class="sa-pv__no-audit">
                                    Kein Audit-Loader konfiguriert.
                                </div>
                            </slot>
                        </template>
                    </template>
                </div>
            </main>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { CatalogSnapshot, RawCatalogData } from '../plan-versions-catalog.js';
import { buildSnapshots } from '../plan-versions-catalog.js';
import PlanVersionsTimeline from './plan-versions/PlanVersionsTimeline.vue';
import PlanVersionHeader from './plan-versions/PlanVersionHeader.vue';
import PlanVersionsList, { type QuotaColumnConfig } from './plan-versions/PlanVersionsList.vue';
import PlanVersionsMatrix from './plan-versions/PlanVersionsMatrix.vue';
import PlanVersionsAudit from './plan-versions/PlanVersionsAudit.vue';
import PlanVersionsDiff from './plan-versions/PlanVersionsDiff.vue';
import type { PlanVersionViewMode } from './plan-versions/types.js';

// Plattform-Standard-Page: Plan-Versionen.
//
// Komponiert die Plan-Versions-Subkomponenten zur kompletten Page. Konsumenten
// reichen `data` (RawCatalogData) durch und erhalten Events für die App-
// spezifischen Edit-/Create-Flüsse (DraftDialog/PublishModal sind absichtlich
// nicht Teil der Plattform — die hängen am App-Feature-Catalog).
//
// Slot-API für reichere App-spezifische Renderings:
//   - `#list`: ersetzt die default PlanVersionsList (z. B. mit Feature-
//             grouping per Plan + zusätzlichen Quota-Spalten).
//   - `#matrix`, `#audit`: analog.

interface FeatureGroupsConfig {
    order: readonly string[];
    byKey: Record<string, string>;
    fallbackGroup?: string;
}

interface AuditRow {
    id: string;
    createdAt: string;
    action: string;
    entity: string;
    entityId: string;
    changes: Record<string, unknown> | null;
    user?: { email: string; firstName?: string; lastName?: string } | null;
    userEmail?: string | null;
}

const props = withDefaults(
    defineProps<{
        data: RawCatalogData;
        loading?: boolean;
        /** Plan-IDs in Anzeigereihenfolge (z. B. BASIC,STANDARD,PROFESSIONAL,…). */
        planSortOrder?: readonly string[];
        /** Erwartete Plan-IDs für „fehlende Pakete"-Warnung. */
        expectedPlanIds?: readonly string[];
        /** Akzentfarbe pro Plan-ID (für Diff-Cards). */
        planAccents?: Record<string, string>;
        /** Feature-Metadaten (Label/Icon/PlannedOnly) für die Matrix. */
        featureRegistry?: Record<string, { label?: string; icon?: string; plannedOnly?: boolean }>;
        /** UX-Gruppierung der Features in der Matrix. */
        featureGroups?: FeatureGroupsConfig;
        /** Audit-Loader (optional; ohne deaktiviert Audit-View). */
        loadAudit?: () => Promise<AuditRow[]>;
        /** App-spezifische Audit-Action-Meta-Map. */
        auditActionMeta?: Record<string, { icon: string; color: string; label: string }>;
        /** Field-Label-Overrides für die Diff-Anzeige. */
        diffFieldLabels?: Record<string, string>;
        /**
         * Optionale Quota-Spalten in der List-View (z. B.
         * Benutzer/Mitglieder/Speicher/Plätze). Wird an PlanVersionsList
         * weitergereicht. Default: keine — alte Anzeige (nur Paket/Preis/Features).
         */
        quotaColumns?: ReadonlyArray<QuotaColumnConfig>;
    }>(),
    {
        loading: false,
    },
);

const emit = defineEmits<{
    (e: 'publish'): void;
    (e: 'editPlanDraft', draftId: string): void;
    (e: 'createPlanDraft', planId: string): void;
}>();

const selectedId = ref<string>('drafts');
const compareId = ref<string | null>(null);
const viewMode = ref<PlanVersionViewMode>('list');

const snapshots = computed<CatalogSnapshot[]>(() =>
    buildSnapshots(props.data, { planSortOrder: props.planSortOrder }),
);

const selected = computed<CatalogSnapshot | null>(
    () => snapshots.value.find((s) => s.id === selectedId.value) ?? null,
);
const compare = computed<CatalogSnapshot | null>(() =>
    compareId.value ? (snapshots.value.find((s) => s.id === compareId.value) ?? null) : null,
);

watch(snapshots, (snaps) => {
    if (!snaps.find((s) => s.id === selectedId.value)) {
        selectedId.value = snaps[0]?.id ?? 'drafts';
    }
});

function onSelect(id: string): void {
    selectedId.value = id;
}

function onSetCompare(id: string): void {
    if (id !== selectedId.value) compareId.value = id;
}
</script>

<style scoped>
.sa-pv {
    display: flex;
    min-height: calc(100vh - 56px);
    background: var(--sa-bg-app, #f1f5f9);
    min-width: 0;
}
.sa-pv__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
}
.sa-pv__body {
    flex: 1;
    overflow-y: auto;
}
.sa-pv__loading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 32px;
    color: var(--sa-muted, #64748b);
}
.sa-pv__no-audit {
    padding: 32px;
    color: var(--sa-muted, #64748b);
    font-style: italic;
}
</style>

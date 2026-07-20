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

// Platform standard page: plan versions.
//
// Composes the plan-versions subcomponents into the complete page. Consumers
// pass `data` (RawCatalogData) through and receive events for the app-
// specific edit/create flows (DraftDialog/PublishModal are intentionally
// not part of the platform — they hang off the app feature catalog).
//
// Slot API for richer app-specific renderings:
//   - `#list`: replaces the default PlanVersionsList (e.g. with feature
//             grouping per plan + additional quota columns).
//   - `#matrix`, `#audit`: analogous.

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
        /** Plan IDs in display order (e.g. BASIC,STANDARD,PROFESSIONAL,…). */
        planSortOrder?: readonly string[];
        /** Expected plan IDs for the "missing packages" warning. */
        expectedPlanIds?: readonly string[];
        /** Accent color per plan ID (for diff cards). */
        planAccents?: Record<string, string>;
        /** Feature metadata (label/icon/plannedOnly) for the matrix. */
        featureRegistry?: Record<string, { label?: string; icon?: string; plannedOnly?: boolean }>;
        /** UX grouping of the features in the matrix. */
        featureGroups?: FeatureGroupsConfig;
        /** Audit loader (optional; without it disables the audit view). */
        loadAudit?: () => Promise<AuditRow[]>;
        /** App-specific audit action meta map. */
        auditActionMeta?: Record<string, { icon: string; color: string; label: string }>;
        /** Field label overrides for the diff display. */
        diffFieldLabels?: Record<string, string>;
        /**
         * Optional quota columns in the list view (e.g.
         * users/members/storage/seats). Passed through to
         * PlanVersionsList. Default: none — old display (only package/price/features).
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

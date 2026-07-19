<template>
    <div class="sa-bd-grid">
        <div class="sa-bd-col">
            <div class="sa-bd-section-label">Stammdaten</div>
            <div class="sa-bundles__form">
                <q-input
                    :model-value="editForm.label"
                    outlined
                    dense
                    label="Label"
                    @update:model-value="(value) => patchEditForm({ label: String(value ?? '') })"
                />
                <q-input
                    :model-value="editForm.description"
                    outlined
                    dense
                    type="textarea"
                    autogrow
                    label="Beschreibung"
                    @update:model-value="
                        (value) => patchEditForm({ description: String(value ?? '') })
                    "
                />
                <q-input
                    :model-value="editForm.icon"
                    outlined
                    dense
                    label="Icon"
                    @update:model-value="(value) => patchEditForm({ icon: String(value ?? '') })"
                />
                <q-input
                    :model-value="editForm.sortOrder"
                    outlined
                    dense
                    type="number"
                    label="Sortier-Reihenfolge"
                    @update:model-value="
                        (value) => patchEditForm({ sortOrder: Number(value ?? 0) })
                    "
                />
            </div>

            <div class="sa-bd-section-label sa-bd-section-label--mt">
                <span>Übersetzungen</span>
                <span class="sa-bd-section-count">{{ translatableLocales.length }} Sprache(n)</span>
            </div>
            <div v-if="translatableLocales.length === 0" class="sa-bd-i18n-hint">
                Keine weiteren Sprachen aktiv — werden im Marketing-Catalog aktiviert.
            </div>
            <div v-for="lng in translatableLocales" :key="lng" class="sa-bd-i18n-block">
                <div class="sa-bd-i18n-head">
                    <span class="sa-bd-i18n-code">{{ lng.toUpperCase() }}</span>
                    <span
                        v-if="!i18nDraft[lng]?.label || !i18nDraft[lng]?.description"
                        class="sa-bd-i18n-fallback"
                    >
                        Fallback aus DE
                    </span>
                </div>
                <q-input
                    outlined
                    dense
                    :model-value="i18nDraft[lng]?.label || ''"
                    :placeholder="`Label (Fallback: „${editForm.label}“)`"
                    @update:model-value="
                        (value) => emit('setI18n', lng, 'label', String(value ?? ''))
                    "
                />
                <q-input
                    outlined
                    dense
                    type="textarea"
                    autogrow
                    :model-value="i18nDraft[lng]?.description || ''"
                    :placeholder="`Beschreibung (Fallback aus DE)`"
                    @update:model-value="
                        (value) => emit('setI18n', lng, 'description', String(value ?? ''))
                    "
                />
            </div>

            <q-btn
                class="sa-bd-save"
                unelevated
                color="primary"
                label="Stammdaten & Übersetzungen speichern"
                :loading="editSubmitting"
                @click="emit('submitEdit')"
            />
        </div>

        <div class="sa-bd-col sa-bd-col--versions">
            <BundleVersionStrip
                :versions="detailVersions"
                :model-value="selectedVersionId"
                @update:model-value="(id) => emit('selectVersion', bundle.id, id)"
                @add-version="emit('addVersion', bundle.id)"
            />

            <BundleVersionInlineEditor
                v-if="selectedVersion"
                :key="selectedVersion.id"
                :version="selectedVersion"
                :available-features="availableFeatures"
                :available-quotas="availableQuotas"
                :plans="plans"
                :live-plan-versions="livePlanVersions"
                :feature-registry="featureRegistry"
                :quota-registry="quotaRegistry"
                :saving="inlineEditorSaving"
                :save-error="inlineEditorError"
                @save="(data) => emit('inlineSave', bundle.id, selectedVersion!.id, data)"
                @discard="emit('discardVersion', bundle.id, selectedVersion!.id)"
            />
            <div v-else class="sa-bd-empty-row">
                Noch keine Version. Lege eine neue Version an, um Features, Quotas &amp; Pricing zu
                kuratieren.
            </div>

            <div class="sa-bd-version-actions">
                <q-btn
                    v-if="selectedVersion && selectedVersion.publishedAt === null"
                    unelevated
                    color="positive"
                    icon="rocket_launch"
                    label="Diese Version publishen"
                    @click="emit('publishVersion', selectedVersion)"
                />
                <q-btn
                    class="sa-bd-delete"
                    flat
                    dense
                    color="negative"
                    icon="delete"
                    label="Bundle soft-deleten"
                    @click="emit('deleteBundle', bundle)"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {
    BundleRow,
    BundleVersionRow,
    CatalogEntryI18n,
    DiscoverySnapshot,
    PlanRow,
    PlanVersionRow,
    UpdateBundleVersionDraftData,
} from '@saasicat/types';
import BundleVersionInlineEditor from '../../components/bundle-editor/BundleVersionInlineEditor.vue';
import BundleVersionStrip from '../../components/bundle-editor/BundleVersionStrip.vue';
import type { FeatureMeta } from '../../components/bundle-editor/BundleFeaturesEditor.vue';
import type { QuotaMeta } from '../../components/bundle-editor/catalog-i18n.js';
import type { BundleEditForm } from './types.js';

const props = defineProps<{
    bundle: BundleRow;
    editForm: BundleEditForm;
    i18nDraft: CatalogEntryI18n;
    translatableLocales: string[];
    editSubmitting: boolean;
    detailVersions: BundleVersionRow[];
    selectedVersionId: string | null;
    selectedVersion: BundleVersionRow | null;
    availableFeatures: DiscoverySnapshot['features'];
    availableQuotas: DiscoverySnapshot['quotas'];
    plans: PlanRow[];
    livePlanVersions: Record<string, PlanVersionRow | null>;
    featureRegistry: Record<string, FeatureMeta>;
    quotaRegistry: Record<string, QuotaMeta>;
    inlineEditorSaving: boolean;
    inlineEditorError: string | null;
}>();

const emit = defineEmits<{
    'update:editForm': [value: BundleEditForm];
    setI18n: [locale: string, field: 'label' | 'description', value: string];
    submitEdit: [];
    selectVersion: [bundleId: string, versionId: string];
    addVersion: [bundleId: string];
    inlineSave: [bundleId: string, versionId: string, data: UpdateBundleVersionDraftData];
    discardVersion: [bundleId: string, versionId: string];
    publishVersion: [version: BundleVersionRow];
    deleteBundle: [bundle: BundleRow];
}>();

function patchEditForm(patch: Partial<BundleEditForm>): void {
    emit('update:editForm', { ...props.editForm, ...patch });
}
</script>

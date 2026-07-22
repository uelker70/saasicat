<template>
    <div class="sa-bd-grid">
        <div class="sa-bd-col">
            <div class="sa-bd-section-label">{{ msg.fields.masterData }}</div>
            <div class="sa-bundles__form">
                <q-input
                    :model-value="editForm.label"
                    outlined
                    dense
                    :label="msg.fields.label"
                    @update:model-value="(value) => patchEditForm({ label: String(value ?? '') })"
                />
                <q-input
                    :model-value="editForm.description"
                    outlined
                    dense
                    type="textarea"
                    autogrow
                    :label="common.description"
                    @update:model-value="
                        (value) => patchEditForm({ description: String(value ?? '') })
                    "
                />
                <q-input
                    :model-value="editForm.icon"
                    outlined
                    dense
                    :label="msg.detail.fieldIcon"
                    @update:model-value="(value) => patchEditForm({ icon: String(value ?? '') })"
                />
                <q-input
                    :model-value="editForm.sortOrder"
                    outlined
                    dense
                    type="number"
                    :label="msg.detail.fieldSortOrder"
                    @update:model-value="
                        (value) => patchEditForm({ sortOrder: Number(value ?? 0) })
                    "
                />
            </div>

            <div class="sa-bd-section-label sa-bd-section-label--mt">
                <span>{{ msg.detail.translations }}</span>
                <span class="sa-bd-section-count">{{ languageCount }}</span>
            </div>
            <div v-if="translatableLocales.length === 0" class="sa-bd-i18n-hint">
                {{ msg.detail.noTranslatableLocales }}
            </div>
            <div v-for="lng in translatableLocales" :key="lng" class="sa-bd-i18n-block">
                <div class="sa-bd-i18n-head">
                    <span class="sa-bd-i18n-code">{{ lng.toUpperCase() }}</span>
                    <span
                        v-if="!i18nDraft[lng]?.label || !i18nDraft[lng]?.description"
                        class="sa-bd-i18n-fallback"
                    >
                        {{ msg.detail.fallbackFromDe }}
                    </span>
                </div>
                <q-input
                    outlined
                    dense
                    :model-value="i18nDraft[lng]?.label || ''"
                    :placeholder="labelPlaceholder"
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
                    :placeholder="msg.detail.descriptionPlaceholder"
                    @update:model-value="
                        (value) => emit('setI18n', lng, 'description', String(value ?? ''))
                    "
                />
            </div>

            <q-btn
                class="sa-bd-save"
                unelevated
                color="primary"
                :label="msg.detail.save"
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
            <div v-else class="sa-bd-empty-row">{{ msg.detail.noVersion }}</div>

            <div class="sa-bd-version-actions">
                <q-btn
                    v-if="selectedVersion && selectedVersion.publishedAt === null"
                    unelevated
                    color="positive"
                    icon="rocket_launch"
                    :label="msg.detail.publishVersion"
                    @click="emit('publishVersion', selectedVersion)"
                />
                <q-btn
                    class="sa-bd-delete"
                    flat
                    dense
                    color="negative"
                    icon="delete"
                    :label="msg.detail.softDelete"
                    @click="emit('deleteBundle', bundle)"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
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

const msg = useSaMessages('bundles');
const common = useSaMessages('common');

const languageCount = computed(() =>
    formatMessage(msg.value.detail.languageCount, { count: props.translatableLocales.length }),
);
const labelPlaceholder = computed(() =>
    formatMessage(msg.value.detail.labelPlaceholder, { label: props.editForm.label }),
);

function patchEditForm(patch: Partial<BundleEditForm>): void {
    emit('update:editForm', { ...props.editForm, ...patch });
}
</script>

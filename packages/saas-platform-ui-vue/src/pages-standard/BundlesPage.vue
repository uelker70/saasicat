<template>
    <div class="sa-bundles">
        <BundlesHeader
            :loading="loading"
            :display-locale="displayLocale"
            :locales="locales"
            @create="openCreatePanel"
            @refresh="load"
            @update:display-locale="(value) => (displayLocale = value)"
        />

        <q-banner v-if="error" class="sa-bundles__error" rounded>
            <template #avatar><q-icon name="warning" color="negative" /></template>
            Fehler beim Laden: {{ error.message }}
        </q-banner>

        <BundlesKpis
            :bundles-total="bundles.length"
            :live-count="liveCount"
            :scheduled-bundles-count="scheduledBundlesCount"
            :total-scheduled-versions="totalScheduledVersions"
            :total-draft-versions="totalDraftVersions"
            :draft-bundles-count="draftBundlesCount"
            :translated-count="translatedCount"
            :locales-count="locales.length"
        />

        <BundlesFilterBar
            v-model:query="query"
            v-model:status-filter="statusFilter"
            :status-filter-options="statusFilterOptions"
        />

        <!-- Inline creation (collapsible panel, replaces the former dialog modal) -->
        <BundleCreatePanel
            v-if="createOpen"
            :project-key="projectKey"
            :available-features="snapshot?.features ?? []"
            :available-quotas="snapshot?.quotas ?? []"
            :plans="plans"
            :live-plan-versions="livePlanVersions"
            :feature-registry="featureRegistryResolved"
            :quota-registry="quotaRegistryResolved"
            :existing-bundle-keys="existingBundleKeys"
            :create="create"
            :create-draft="createDraft"
            @cancel="createOpen = false"
            @created="onWizardCreated"
        />

        <q-banner
            v-if="bundles.length === 0 && !loading && !error"
            class="sa-bundles__empty"
            rounded
        >
            <template #avatar><q-icon name="info" color="info" /></template>
            Noch keine Bundles angelegt. Über <strong>Neues Bundle</strong> einen Bundle-Stamm
            anlegen, dann Features &amp; Quotas in einer Draft-Version kuratieren.
        </q-banner>

        <BundleAccordionList
            :filtered-bundles="filteredBundles"
            :bundles-total="bundles.length"
            :open-key="openKey"
            :aggregate-status-of="aggregateStatusOf"
            :i18n-locale-count="i18nLocaleCount"
            @toggle="toggle"
        >
            <template #detail="{ bundle }">
                <BundleDetailPanel
                    :bundle="bundle"
                    v-model:edit-form="editForm"
                    :i18n-draft="i18nDraft"
                    :translatable-locales="translatableLocales"
                    :edit-submitting="editSubmitting"
                    :detail-versions="detailVersions"
                    :selected-version-id="selectedVersionIdByBundle[bundle.id] ?? null"
                    :selected-version="selectedVersion"
                    :available-features="snapshot?.features ?? []"
                    :available-quotas="snapshot?.quotas ?? []"
                    :plans="plans"
                    :live-plan-versions="livePlanVersions"
                    :feature-registry="featureRegistryResolved"
                    :quota-registry="quotaRegistryResolved"
                    :inline-editor-saving="inlineEditorSaving"
                    :inline-editor-error="inlineEditorError"
                    @set-i18n="setI18n"
                    @submit-edit="submitEdit"
                    @select-version="onSelectVersion"
                    @add-version="onAddVersion"
                    @inline-save="onInlineSave"
                    @discard-version="onDiscardVersion"
                    @publish-version="openPublish"
                    @delete-bundle="confirmDelete"
                />
            </template>
        </BundleAccordionList>

        <!-- Strict mode warnings after the last mutation -->
        <q-banner
            v-if="lastWarnings.length > 0"
            class="sa-bundles__warnings-banner"
            inline-actions
            rounded
        >
            <template #avatar><q-icon name="warning" color="warning" /></template>
            <strong>{{ lastWarnings.length }} Strict-Mode-Warnung(en) bei letzter Operation</strong>
            <ul class="sa-bundles__warnings-list">
                <li v-for="(w, i) in lastWarnings" :key="i">
                    <code>{{ w.code }}</code>
                    <template v-if="w.value">
                        · <code>{{ w.value }}</code></template
                    >
                    — {{ w.message }}
                </li>
            </ul>
            <template #action>
                <q-btn flat dense label="Schließen" @click="lastWarnings = []" />
            </template>
        </q-banner>

        <!-- Publish confirmation modal -->
        <BundleVersionPublishDialog
            v-if="detailBundle && publishOpen && publishDraft"
            v-model="publishOpen"
            :bundle-key="detailBundle.bundleKey"
            :draft="publishDraft"
            :previous="publishPrevious"
            :warnings="lastWarnings"
            :classify-diff="classifyDiff"
            :submit="onPublishSubmit"
            @submitted="onPublishSubmitted"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type {
    BundleRow,
    BundleVersionMutationResult,
    BundleVersionRow,
    CatalogEntryI18n,
    CreateBundleData,
    CreateBundleVersionDraftData,
    DiscoverySnapshot,
    FeatureCatalogEntryRow,
    PlanRow,
    PlanVersionRow,
    QuotaCatalogEntryRow,
    StrictModeWarning,
    UpdateBundleData,
    UpdateBundleVersionDraftData,
    VersionChange,
} from '@saasicat/types';

import BundleVersionPublishDialog from '../components/BundleVersionPublishDialog.vue';
import BundleCreatePanel from '../components/bundle-editor/BundleCreatePanel.vue';
import type { FeatureMeta } from '../components/bundle-editor/BundleFeaturesEditor.vue';
import {
    buildFeatureRegistry,
    buildQuotaRegistry,
    type QuotaMeta,
} from '../components/bundle-editor/catalog-i18n.js';
import {
    bundleActiveVersionAt,
    bundleAggregateStatus,
    bundleVersionStatus,
    bundleVersionsSorted,
    type BundleAggregateStatus,
} from '../components/bundle-editor/bundle-version-status';
import BundleAccordionList from './bundles-page/BundleAccordionList.vue';
import BundleDetailPanel from './bundles-page/BundleDetailPanel.vue';
import BundlesFilterBar from './bundles-page/BundlesFilterBar.vue';
import BundlesHeader from './bundles-page/BundlesHeader.vue';
import BundlesKpis from './bundles-page/BundlesKpis.vue';
import type {
    BundleEditForm,
    BundlesStatusFilter,
    BundlesStatusFilterOption,
} from './bundles-page/types.js';

// Platform standard page: Bundles (SPEC_V2 §6.4, §11.1 M6 Pack 2c +
// Pack 2d inline editor after plan simulation). Dumb component —
// the consumer wrapper supplies the composable results + plan-root
// list + live PlanVersion index as props.

const DEFAULT_LOCALE = 'de';

const props = withDefaults(
    defineProps<{
        projectKey: string;
        bundles: BundleRow[];
        loading: boolean;
        error: Error | null;
        /** Active locales from the project (incl. default). Default: only `de`. */
        activeLocales?: string[];
        /** Plan roots for the compat picker in the inline editor. */
        plans?: PlanRow[];
        /**
         * Live (or latest) PlanVersion per `planKey` — source for the
         * Plan↔Bundle overlap calculation. The wrapper can assemble it via
         * `usePlanVersions`.
         */
        livePlanVersions?: Record<string, PlanVersionRow | null>;
        /**
         * Optional manual feature label/group mapping. Overrides the
         * labels derived from `featureCatalog` (rarely needed).
         */
        featureRegistry?: Record<string, FeatureMeta>;
        /**
         * Feature catalog entries (incl. `i18n`) for label resolution in the
         * chosen display language. The wrapper supplies them via `useCatalogEntries`.
         */
        featureCatalog?: FeatureCatalogEntryRow[];
        /** Quota catalog entries (incl. `i18n`) for label/unit resolution. */
        quotaCatalog?: QuotaCatalogEntryRow[];
        load: () => Promise<void>;
        create: (data: CreateBundleData) => Promise<BundleRow>;
        update: (bundleId: string, data: UpdateBundleData) => Promise<BundleRow>;
        softDelete: (bundleId: string) => Promise<void>;
        loadVersions: (bundleId: string) => Promise<BundleVersionRow[]>;
        createDraft: (
            bundleId: string,
            data: Omit<CreateBundleVersionDraftData, 'bundleId'>,
        ) => Promise<BundleVersionMutationResult>;
        updateDraft: (
            versionId: string,
            data: UpdateBundleVersionDraftData,
        ) => Promise<BundleVersionMutationResult>;
        publish: (
            versionId: string,
            opts: {
                forceRegressive?: boolean;
                validFrom?: string | null;
                validUntil?: string | null;
            },
        ) => Promise<BundleVersionMutationResult>;
        /** Optional: discard a draft (DELETE /catalog/bundle-versions/:id). */
        discardDraft?: (versionId: string) => Promise<void>;
        /**
         * Optional: mapping `bundleId → BundleVersionRow[]` for correct
         * KPI/status-filter display across all bundles. Without this prop
         * the KPIs fall back to "0", because the lazily loaded
         * `detailVersions` only cover the open bundle. The wrapper usually
         * supplies it via `useBundleVersionsMap`.
         */
        versionsByBundle?: Record<string, BundleVersionRow[]>;
        snapshot: DiscoverySnapshot | null;
        classifyDiff: (
            previous: BundleVersionRow,
            draft: BundleVersionRow,
        ) => { changes: VersionChange[]; nonRegressive: boolean };
    }>(),
    {
        plans: () => [],
        livePlanVersions: () => ({}),
        featureRegistry: () => ({}),
        featureCatalog: () => [],
        quotaCatalog: () => [],
        activeLocales: () => [DEFAULT_LOCALE],
        versionsByBundle: () => ({}),
    },
);

const locales = computed(() => props.activeLocales ?? [DEFAULT_LOCALE]);
const translatableLocales = computed(() => locales.value.filter((l) => l !== DEFAULT_LOCALE));

// ─── Display language for feature/quota labels (creation + detail) ───
const displayLocale = ref(DEFAULT_LOCALE);

// Catalog-derived registries in the chosen display language; a
// manually passed `featureRegistry` takes precedence (override).
const featureRegistryResolved = computed<Record<string, FeatureMeta>>(() => ({
    ...buildFeatureRegistry(props.featureCatalog, displayLocale.value),
    ...props.featureRegistry,
}));
const quotaRegistryResolved = computed<Record<string, QuotaMeta>>(() =>
    buildQuotaRegistry(props.quotaCatalog, displayLocale.value),
);

const query = ref('');

// ─── Status filter + KPI aggregates across all bundles ───
const statusFilter = ref<BundlesStatusFilter>('all');

function versionsOf(bundleId: string): BundleVersionRow[] {
    // Prefers the versionsByBundle supplied by the wrapper; falls back to
    // detailVersions when the open bundle was just loaded
    // (between wrapper refresh and map update).
    const fromMap = props.versionsByBundle[bundleId];
    if (fromMap && fromMap.length > 0) return fromMap;
    if (openKey.value === bundleId) return detailVersions.value;
    return fromMap ?? [];
}

function aggregateStatusOf(b: BundleRow): BundleAggregateStatus {
    return bundleAggregateStatus(versionsOf(b.id), b.deletedAt);
}

const filteredBundles = computed(() => {
    const q = query.value?.trim().toLowerCase() ?? '';
    return props.bundles.filter((b) => {
        if (q && !b.bundleKey.toLowerCase().includes(q) && !b.label.toLowerCase().includes(q)) {
            return false;
        }
        if (statusFilter.value !== 'all' && aggregateStatusOf(b) !== statusFilter.value) {
            return false;
        }
        return true;
    });
});

function i18nLocaleCount(b: BundleRow): number {
    return Object.keys(b.i18n ?? {}).length;
}
const translatedCount = computed(() => props.bundles.filter((b) => i18nLocaleCount(b) > 0).length);

const liveCount = computed(
    () => props.bundles.filter((b) => aggregateStatusOf(b) === 'live').length,
);
const scheduledBundlesCount = computed(
    () => props.bundles.filter((b) => aggregateStatusOf(b) === 'scheduled').length,
);
const draftBundlesCount = computed(
    () => props.bundles.filter((b) => aggregateStatusOf(b) === 'draft').length,
);
const totalDraftVersions = computed(() => {
    let n = 0;
    for (const b of props.bundles) {
        for (const v of versionsOf(b.id)) {
            if (v.publishedAt === null) n += 1;
        }
    }
    return n;
});
const totalScheduledVersions = computed(() => {
    let n = 0;
    for (const b of props.bundles) {
        for (const v of versionsOf(b.id)) {
            if (bundleVersionStatus(v) === 'scheduled') n += 1;
        }
    }
    return n;
});

// ─── Inline creation panel (5 sections, at the top of the list) ───
const createOpen = ref(false);

/** For the bundle-key conflict check in the wizard. */
const existingBundleKeys = computed(() => props.bundles.map((b) => b.bundleKey));

const statusFilterOptions: BundlesStatusFilterOption[] = [
    { label: 'Alle Status', value: 'all' as const },
    { label: 'Nur Live', value: 'live' as const },
    { label: 'Mit geplanter Version', value: 'scheduled' as const },
    { label: 'Drafts', value: 'draft' as const },
    { label: 'Abgelöste', value: 'superseded' as const },
    { label: 'Retired', value: 'retired' as const },
];

function openCreatePanel(): void {
    createOpen.value = true;
}

async function onWizardCreated(bundle: BundleRow): Promise<void> {
    // Creation wrote the root + v1 draft in a single atom. Close the
    // panel, reload the list, then expand the freshly created bundle
    // so the user can keep working directly in the inline editor.
    createOpen.value = false;
    await props.load();
    if (openKey.value !== bundle.id) {
        openKey.value = null;
        const next = props.bundles.find((b) => b.id === bundle.id);
        if (next) await toggle(next);
    }
}

// ─── Accordion / detail ───
const openKey = ref<string | null>(null);
const detailVersions = ref<BundleVersionRow[]>([]);
const editForm = ref<BundleEditForm>({
    label: '',
    description: '',
    icon: '',
    sortOrder: 0,
});
const i18nDraft = ref<CatalogEntryI18n>({});
const editSubmitting = ref(false);

const detailBundle = computed<BundleRow | null>(
    () => props.bundles.find((b) => b.id === openKey.value) ?? null,
);

async function toggle(bundle: BundleRow): Promise<void> {
    if (openKey.value === bundle.id) {
        openKey.value = null;
        return;
    }
    openKey.value = bundle.id;
    editForm.value = {
        label: bundle.label,
        description: bundle.description ?? '',
        icon: bundle.icon ?? '',
        sortOrder: bundle.sortOrder,
    };
    i18nDraft.value = JSON.parse(JSON.stringify(bundle.i18n ?? {})) as CatalogEntryI18n;
    detailVersions.value = [];
    inlineEditorError.value = null;
    detailVersions.value = await props.loadVersions(bundle.id);
    if (!selectedVersionIdByBundle.value[bundle.id]) {
        const defaultVersion = defaultSelectedVersion(detailVersions.value);
        if (defaultVersion) {
            onSelectVersion(bundle.id, defaultVersion.id);
        }
    }
}

function setI18n(locale: string, field: 'label' | 'description', value: string): void {
    const next: CatalogEntryI18n = { ...i18nDraft.value };
    const entry = { ...(next[locale] ?? {}) };
    if (value) {
        entry[field] = value;
    } else {
        delete entry[field];
    }
    next[locale] = entry;
    i18nDraft.value = next;
}

async function submitEdit(): Promise<void> {
    if (!detailBundle.value) return;
    editSubmitting.value = true;
    try {
        await props.update(detailBundle.value.id, {
            label: editForm.value.label,
            description: editForm.value.description || null,
            icon: editForm.value.icon || null,
            sortOrder: editForm.value.sortOrder,
            i18n: i18nDraft.value,
        });
    } finally {
        editSubmitting.value = false;
    }
}

async function confirmDelete(bundle: BundleRow): Promise<void> {
    const ok = window.confirm(
        `Bundle '${bundle.bundleKey}' wirklich soft-deleten? Bestand bleibt durch ` +
            `published BundleVersions geschützt.`,
    );
    if (!ok) return;
    await props.softDelete(bundle.id);
    if (openKey.value === bundle.id) openKey.value = null;
}

watch(
    () => props.bundles,
    (next) => {
        if (openKey.value && !next.some((b) => b.id === openKey.value)) {
            openKey.value = null;
        }
    },
);

// ─── Strict mode warnings ───
const lastWarnings = ref<StrictModeWarning[]>([]);

// ─── Inline editor (selected version per bundle) ───
const selectedVersionIdByBundle = ref<Record<string, string | null>>({});
const inlineEditorSaving = ref(false);
const inlineEditorError = ref<string | null>(null);

const selectedVersion = computed<BundleVersionRow | null>(() => {
    if (!detailBundle.value) return null;
    const id = selectedVersionIdByBundle.value[detailBundle.value.id];
    if (!id) return null;
    return detailVersions.value.find((v) => v.id === id) ?? null;
});

function defaultSelectedVersion(versions: BundleVersionRow[]): BundleVersionRow | null {
    if (versions.length === 0) return null;
    // Preferred: the draft (exactly one allowed) → then scheduled →
    // then live → then latest.
    const draft = versions.find((v) => v.publishedAt === null);
    if (draft) return draft;
    const sorted = bundleVersionsSorted(versions);
    const scheduled = sorted.find(
        (v) => v.validFrom && new Date(v.validFrom).getTime() > Date.now(),
    );
    if (scheduled) return scheduled;
    const live = bundleActiveVersionAt(versions);
    if (live) return live;
    return sorted[sorted.length - 1];
}

function onSelectVersion(bundleId: string, versionId: string): void {
    selectedVersionIdByBundle.value = {
        ...selectedVersionIdByBundle.value,
        [bundleId]: versionId,
    };
    inlineEditorError.value = null;
}

/**
 * "Neue Version" button in the version strip: creates a draft (defaults
 * from the last live version) and selects it in the inline editor.
 * The backend blocks a second draft via a partial unique index — the strip
 * disables the button accordingly, but we double-check defensively.
 */
async function onAddVersion(bundleId: string): Promise<void> {
    if (detailVersions.value.some((v) => v.publishedAt === null)) return;
    const sortedVersions = bundleVersionsSorted(detailVersions.value);
    const previous =
        bundleActiveVersionAt(detailVersions.value) ??
        sortedVersions[sortedVersions.length - 1] ??
        null;
    inlineEditorError.value = null;
    inlineEditorSaving.value = true;
    try {
        const result = await props.createDraft(bundleId, {
            features: previous ? [...previous.features] : [],
            quotas: previous ? { ...previous.quotas } : {},
            compatibility: previous?.compatibility ?? {},
            pricingOverrides: previous?.pricingOverrides ?? [],
            monthlyNet: previous?.monthlyNet ?? null,
            yearlyNet: previous?.yearlyNet ?? null,
            marketed: previous?.marketed ?? true,
            changeNote: '',
        });
        lastWarnings.value = result.warnings;
        detailVersions.value = await props.loadVersions(bundleId);
        onSelectVersion(bundleId, result.bundleVersion.id);
    } catch (err) {
        inlineEditorError.value = err instanceof Error ? err.message : String(err);
    } finally {
        inlineEditorSaving.value = false;
    }
}

async function onInlineSave(
    bundleId: string,
    versionId: string,
    data: UpdateBundleVersionDraftData,
): Promise<void> {
    inlineEditorSaving.value = true;
    inlineEditorError.value = null;
    try {
        const result = await props.updateDraft(versionId, data);
        lastWarnings.value = result.warnings;
        detailVersions.value = await props.loadVersions(bundleId);
        // If the backend does not change the ID, the selection stays put.
    } catch (err) {
        inlineEditorError.value = err instanceof Error ? err.message : String(err);
    } finally {
        inlineEditorSaving.value = false;
    }
}

/**
 * Discards a draft or scheduled version. Works only if the
 * wrapper passes `discardDraft` through; without the prop we show a
 * clear error message instead of a silent no-op.
 */
async function onDiscardVersion(bundleId: string, versionId: string): Promise<void> {
    if (!props.discardDraft) {
        inlineEditorError.value =
            'Discard ist im Wrapper nicht verdrahtet — bitte `discardDraft`-Prop ergänzen.';
        return;
    }
    const ok = window.confirm('Diese Draft-Version verwerfen? Der Inhalt geht verloren.');
    if (!ok) return;
    inlineEditorSaving.value = true;
    inlineEditorError.value = null;
    try {
        await props.discardDraft(versionId);
        // Remove from local list + re-select sensibly.
        detailVersions.value = await props.loadVersions(bundleId);
        const next = defaultSelectedVersion(detailVersions.value);
        selectedVersionIdByBundle.value = {
            ...selectedVersionIdByBundle.value,
            [bundleId]: next?.id ?? null,
        };
    } catch (err) {
        inlineEditorError.value = err instanceof Error ? err.message : String(err);
    } finally {
        inlineEditorSaving.value = false;
    }
}

// ─── Publish confirmation modal ───
const publishOpen = ref(false);
const publishDraft = ref<BundleVersionRow | null>(null);

const publishPrevious = computed<BundleVersionRow | null>(() => {
    if (!publishDraft.value) return null;
    return (
        detailVersions.value
            .filter((v) => v.publishedAt !== null && v.supersededAt === null)
            .sort((a, b) => b.version - a.version)[0] ?? null
    );
});

function openPublish(version: BundleVersionRow): void {
    if (version.publishedAt !== null) return;
    publishDraft.value = version;
    publishOpen.value = true;
}

async function onPublishSubmit(opts: {
    forceRegressive: boolean;
    allowZeroPrice?: boolean;
    validFrom?: string | null;
    validUntil?: string | null;
}): Promise<BundleVersionMutationResult> {
    if (!publishDraft.value) {
        throw new Error('BundlesPage: publish submit ohne Draft-Kontext');
    }
    return props.publish(publishDraft.value.id, opts);
}

async function onPublishSubmitted(result: BundleVersionMutationResult): Promise<void> {
    lastWarnings.value = result.warnings;
    publishDraft.value = null;
    if (detailBundle.value) {
        detailVersions.value = await props.loadVersions(detailBundle.value.id);
    }
}

const classifyDiff = computed(() => props.classifyDiff);
</script>

<style>
.sa-bundles {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.sa-bundles__head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
}
.sa-bundles__title {
    font-size: 20px;
    font-weight: 700;
    margin: 0;
}
.sa-bundles__sub {
    margin: 4px 0 0;
    color: #64748b;
    font-size: 12px;
    max-width: 560px;
}
.sa-bundles__head-actions {
    display: flex;
    align-items: center;
    gap: 12px;
}
.sa-bundles__error {
    border-left: 4px solid #dc2626;
}
.sa-bundles__empty {
    border-left: 4px solid #31ccec;
}
.sa-bundles__kpis {
    display: grid;
    /* Responsive: as many KPIs as fit (up to 4), then 3 → 2 → 1. */
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
}
.sa-bundles__kpi {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
}
.sa-bundles__kpi-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #64748b;
}
.sa-bundles__kpi-value {
    font-size: 26px;
    font-weight: 700;
}
.sa-bundles__kpi-sub {
    font-size: 11px;
    color: #94a3b8;
}
.sa-bundles__filter-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.sa-bundles__search {
    max-width: 420px;
    flex: 1 1 280px;
}
.sa-bundles__status-filter {
    min-width: 220px;
}
.sa-bundles__list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.sa-bd-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    overflow: hidden;
}
.sa-bd-card.open {
    border-color: #3f6bff;
}
.sa-bd-card__head {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 12px 14px;
    cursor: pointer;
}
.sa-bd-card__mark {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    background: #eff6ff;
    color: #1d4ed8;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.sa-bd-card__titlewrap {
    flex: 1;
    min-width: 0;
}
.sa-bd-card__titlerow {
    display: flex;
    gap: 8px;
    align-items: center;
}
.sa-bd-card__key {
    font-weight: 700;
    font-size: 12px;
    font-family: var(--sa-font-mono, ui-monospace, monospace);
}
.sa-bd-card__name {
    font-size: 13px;
    font-weight: 600;
    margin-top: 2px;
}
.sa-bd-card__desc {
    font-size: 12px;
    color: #64748b;
}
.sa-bd-card__chev {
    transition: transform 0.15s;
    color: #94a3b8;
}
.sa-bd-card__chev.open {
    transform: rotate(90deg);
}
.sa-bd-card__body {
    border-top: 1px solid #e2e8f0;
    padding: 14px;
    background: #f8fafc;
}
.sa-bd-grid {
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 18px;
}
@media (max-width: 980px) {
    .sa-bd-grid {
        grid-template-columns: 1fr;
    }
}
.sa-bd-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.sa-bd-col--versions {
    gap: 14px;
}
.sa-bd-version-actions {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 4px;
}
.sa-bd-section-label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #475569;
    display: flex;
    justify-content: space-between;
}
.sa-bd-section-label--mt {
    margin-top: 10px;
}
.sa-bd-section-count {
    color: #94a3b8;
    font-weight: 600;
}
.sa-bundles__form {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.sa-bd-i18n-hint {
    font-size: 11px;
    color: #94a3b8;
}
.sa-bd-i18n-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #fff;
}
.sa-bd-i18n-head {
    display: flex;
    gap: 8px;
    align-items: center;
}
.sa-bd-i18n-code {
    font-size: 10px;
    font-weight: 700;
    background: #f1f5f9;
    padding: 2px 7px;
    border-radius: 5px;
}
.sa-bd-i18n-fallback {
    font-size: 10px;
    color: #b45309;
}
.sa-bd-save {
    margin-top: 8px;
    align-self: flex-start;
}
.sa-bd-delete {
    margin-top: 8px;
    align-self: flex-start;
}
.sa-bd-version {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px;
}
.sa-bd-version__main {
    flex: 1;
    min-width: 0;
}
.sa-bd-version__titlerow {
    display: flex;
    gap: 8px;
    align-items: center;
}
.sa-bd-version__sub {
    font-size: 11px;
    color: #64748b;
    margin: 2px 0;
}
.sa-bd-version__feats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.sa-bd-feat-chip {
    font-size: 10px;
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 5px;
}
.sa-bd-version__act {
    display: flex;
    gap: 2px;
}
.sa-bd-empty-row {
    padding: 20px;
    text-align: center;
    color: #94a3b8;
    font-size: 12px;
    border: 1px dashed #cbd5e1;
    border-radius: 8px;
}
.sa-bundles__warnings-banner {
    border-left: 4px solid #f2c037;
}
.sa-bundles__warnings-list {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 13px;
}
</style>

<template>
    <AdminPage class="sa-bundles">
        <AdminHero :title="msg.header.title" :subtitle="msg.header.subtitle">
            <template #actions>
                <BundlesToolbar
                    :loading="loading"
                    :display-locale="displayLocale"
                    :locales="locales"
                    @create="openCreatePanel"
                    @refresh="reload"
                    @update:display-locale="(value) => (displayLocale = value)"
                />
            </template>
        </AdminHero>

        <AdminBody>
            <AdminErrorBanner :error="error" />

            <AdminSection>
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
            </AdminSection>

            <AdminSection class="sa-bundles__filter">
                <BundlesFilterBar
                    v-model:query="query"
                    v-model:status-filter="statusFilter"
                    class="q-mb-md"
                    :status-filter-options="statusFilterOptions"
                />

                <!-- Inline creation (collapsible panel, replaces the former dialog modal) -->
                <BundleCreatePanel
                    v-if="createOpen"
                    class="q-mb-sm"
                    :project-key="projectKey"
                    :available-features="snapshot?.features ?? []"
                    :available-quotas="snapshot?.quotas ?? []"
                    :plans="plans"
                    :live-plan-versions="livePlanVersions"
                    :feature-registry="featureRegistryResolved"
                    :quota-registry="quotaRegistryResolved"
                    :existing-bundle-keys="existingBundleKeys"
                    :create="bundlesOps.create"
                    :create-draft="versionsOps.createDraft"
                    @cancel="createOpen = false"
                    @created="onWizardCreated"
                />

                <AdminBanner v-if="bundles.length === 0 && !loading && !error" tone="info">
                    {{ msg.page.emptyBefore }} <strong>{{ msg.header.newBundle }}</strong>
                    {{ msg.page.emptyAfter }}
                </AdminBanner>

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
                            v-model:edit-form="editForm"
                            :bundle="bundle"
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
            </AdminSection>

            <!-- Strict mode warnings after the last mutation -->
            <AdminBanner v-if="lastWarnings.length > 0" tone="warning">
                <strong>{{ strictWarningsText }}</strong>
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
                    <q-btn flat dense :label="common.close" @click="lastWarnings = []" />
                </template>
            </AdminBanner>
        </AdminBody>

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
    </AdminPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSuperAdminManifest } from '../vue/use-super-admin-context.js';
import { classifyBundleVersionDiff } from '@saasicat/types';
import { useResource } from '../vue/resource-registry.js';
import { useSuperAdminEndpoints } from '../vue/use-super-admin-context.js';
import type { ResourceOverride } from '../vue/resource-registry.js';
import type {
    bundlesResource,
    bundleVersionsResource,
} from '../client/resources/bundles.resource.js';
import type { catalogResource } from '../client/resources/catalog.resource.js';
import type { planVersionsResource, plansResource } from '../client/resources/plans.resource.js';
import { findLatestLive } from '../vue/use-live-plan-versions.js';
import type { discoveryResource } from '../client/resources/discovery.resource.js';
import AdminBanner from '../ui/feedback/AdminBanner.vue';
import AdminErrorBanner from '../ui/feedback/AdminErrorBanner.vue';
import type {
    BundleRow,
    BundleVersionMutationResult,
    BundleVersionRow,
    CatalogEntryI18n,
    DiscoverySnapshot,
    FeatureCatalogEntryRow,
    PlanRow,
    PlanVersionRow,
    QuotaCatalogEntryRow,
    StrictModeWarning,
    UpdateBundleVersionDraftData,
} from '@saasicat/types';

import BundleVersionPublishDialog from '../features/bundle/BundleVersionPublishDialog.vue';
import BundleCreatePanel from '../features/bundle/internal/BundleCreatePanel.vue';
import type { FeatureMeta } from '../features/bundle/internal/BundleFeaturesEditor.vue';
import {
    buildFeatureRegistry,
    buildQuotaRegistry,
    type QuotaMeta,
} from '../features/bundle/internal/catalog-i18n.js';
import {
    bundleActiveVersionAt,
    bundleAggregateStatus,
    bundleVersionStatus,
    bundleVersionsSorted,
    type BundleAggregateStatus,
} from '../features/bundle/internal/bundle-version-status';
import { formatMessage } from '../client/i18n/format.js';
import { useSaMessages } from '../vue/use-super-admin-i18n.js';
import BundleAccordionList from '../internal/bundles-page/BundleAccordionList.vue';
import BundleDetailPanel from '../internal/bundles-page/BundleDetailPanel.vue';
import BundlesFilterBar from '../internal/bundles-page/BundlesFilterBar.vue';
import AdminBody from '../ui/page/AdminBody.vue';
import AdminHero from '../ui/page/AdminHero.vue';
import AdminSection from '../ui/page/AdminSection.vue';
import AdminPage from '../ui/page/AdminPage.vue';
import BundlesToolbar from '../internal/bundles-page/BundlesToolbar.vue';
import BundlesKpis from '../internal/bundles-page/BundlesKpis.vue';
import type {
    BundleEditForm,
    BundlesStatusFilter,
    BundlesStatusFilterOption,
} from '../internal/bundles-page/types.js';

// Platform standard page: Bundles (§11.1 M6 Pack 2c +
// Pack 2d inline editor after plan simulation). Dumb component —
// the consumer wrapper supplies the composable results + plan-root
// list + live PlanVersion index as props.

/**
 * What an app may change about this page.
 *
 * One object rather than 6 props, per AP3 §3.2: a page's contract is
 * `resources`, `params` and `options`, whatever the number of knobs behind
 * the last one.
 */
export interface BundlesPageOptions {
    /**
     * Locales a catalog entry may be written in.
     *
     * Defaults to the manifest's `project.availableLocales`, which is where
     * the shell already has it — an app only passes this when it wants a
     * narrower pool than its own configuration declares.
     */
    activeLocales?: string[];
    /**
     * Optional manual feature label/group mapping. Overrides the labels
     * derived from the catalog (rarely needed).
     */
    featureRegistry?: Record<string, FeatureMeta>;
}

const DEFAULT_LOCALE = 'de';

const props = defineProps<{
    /**
     * Override the bundle resources for this page only — a different host,
     * or one operation wrapped. Layered over the app's own override; see
     * AP3 §3.2.
     */
    resources?: {
        bundles?: ResourceOverride<(typeof bundlesResource)['ops']>;
        bundleVersions?: ResourceOverride<(typeof bundleVersionsResource)['ops']>;
        catalog?: ResourceOverride<(typeof catalogResource)['ops']>;
        plans?: ResourceOverride<(typeof plansResource)['ops']>;
        planVersions?: ResourceOverride<(typeof planVersionsResource)['ops']>;
        discovery?: ResourceOverride<(typeof discoveryResource)['ops']>;
    };
    /** Presentation and capability. Never data, never a callback. */
    options?: BundlesPageOptions;
}>();

// ── The data layer, reached by name ──────────────────────────────────────────
//
// This page took THIRTY-THREE props, ten of them callbacks, and every consumer
// wired four composables by hand to produce them — `useBundles`,
// `useBundleVersionsMap`, `useCatalogEntries`, `usePlanVersions` — plus a
// snapshot loader. All five read endpoints these resources already declare.
// The project the shell was configured for. It used to be a prop, which meant
// an app could hand this page a different project than the one its resources
// read from — two answers to one question.
const { projectKey } = useSuperAdminEndpoints();

const bundlesOps = useResource('bundles', props.resources?.bundles);
const versionsOps = useResource('bundleVersions', props.resources?.bundleVersions);
const catalogOps = useResource('catalog', props.resources?.catalog);
const plansOps = useResource('plans', props.resources?.plans);
const planVersionsOps = useResource('planVersions', props.resources?.planVersions);
const discoveryOps = useResource('discovery', props.resources?.discovery);

const bundles = ref<BundleRow[]>([]);
const plans = ref<PlanRow[]>([]);
const livePlanVersions = ref<Record<string, PlanVersionRow | null>>({});
const featureCatalog = ref<FeatureCatalogEntryRow[]>([]);
const quotaCatalog = ref<QuotaCatalogEntryRow[]>([]);
const versionsByBundle = ref<Record<string, BundleVersionRow[]>>({});
const snapshot = ref<DiscoverySnapshot | null>(null);
const loading = ref(false);
const error = ref<unknown>(null);

/**
 * Every version of every bundle, for the KPIs and the status filter.
 *
 * The detail pane loads one bundle's versions on demand; without this map the
 * tiles counted only the open bundle and read zero for everything else.
 */
async function loadVersionsMap(rows: readonly BundleRow[]): Promise<void> {
    const pairs = await Promise.all(
        rows.map(async (row) => [row.id, await versionsOps.listForBundle(row.id)] as const),
    );
    versionsByBundle.value = Object.fromEntries(pairs);
}

/**
 * The live version of every plan, for the Plan↔Bundle overlap check in the
 * compat picker. The wrapper used to supply this through `useLivePlanVersions`;
 * after 4.10 the page owns it, and a map that is never filled turns the
 * warning off without anything on screen looking wrong. One plan failing to
 * load does not take the others with it, as the composable had it.
 */
async function loadLivePlanVersions(planRows: PlanRow[]): Promise<void> {
    const entries = await Promise.all(
        planRows.map(async (plan) => {
            try {
                return [
                    plan.planKey,
                    findLatestLive(await planVersionsOps.listForPlan(plan.id)),
                ] as const;
            } catch (err) {
                console.warn(
                    `BundlesPage: loading the versions of plan '${plan.planKey}' failed`,
                    err,
                );
                return [plan.planKey, null] as const;
            }
        }),
    );
    livePlanVersions.value = Object.fromEntries(entries);
}

async function reload(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
        const [rows, planRows, features, quotas, read] = await Promise.all([
            bundlesOps.list(),
            plansOps.list(),
            catalogOps.features(),
            catalogOps.quotas(),
            discoveryOps.read(null),
        ]);
        bundles.value = rows;
        plans.value = planRows;
        featureCatalog.value = features;
        quotaCatalog.value = quotas;
        if (read.status === 'loaded') snapshot.value = read.snapshot;
        await Promise.all([loadVersionsMap(rows), loadLivePlanVersions(planRows)]);
    } catch (err) {
        error.value = err;
    } finally {
        loading.value = false;
    }
}

onMounted(() => void reload());

const msg = useSaMessages('bundles');
const common = useSaMessages('common');

// The pool this project declares, unless the app narrows it. Read here rather
// than taken as a required prop: the shell already holds the manifest, and a
// consumer passing it back was the last reason its wrapper existed.
const manifest = useSuperAdminManifest();
const locales = computed(
    () => props.options?.activeLocales ?? manifest?.project?.availableLocales ?? [DEFAULT_LOCALE],
);
const translatableLocales = computed(() => locales.value.filter((l) => l !== DEFAULT_LOCALE));

// ─── Display language for feature/quota labels (creation + detail) ───
const displayLocale = ref(DEFAULT_LOCALE);

// Catalog-derived registries in the chosen display language; a
// manually passed `featureRegistry` takes precedence (override).
const featureRegistryResolved = computed<Record<string, FeatureMeta>>(() => ({
    ...buildFeatureRegistry(featureCatalog.value, displayLocale.value),
    ...props.options?.featureRegistry,
}));
const quotaRegistryResolved = computed<Record<string, QuotaMeta>>(() =>
    buildQuotaRegistry(quotaCatalog.value, displayLocale.value),
);

const query = ref('');

// ─── Status filter + KPI aggregates across all bundles ───
const statusFilter = ref<BundlesStatusFilter>('all');

function versionsOf(bundleId: string): BundleVersionRow[] {
    // Prefers the versionsByBundle supplied by the wrapper; falls back to
    // detailVersions when the open bundle was just loaded
    // (between wrapper refresh and map update).
    const fromMap = versionsByBundle.value[bundleId];
    if (fromMap && fromMap.length > 0) return fromMap;
    if (openKey.value === bundleId) return detailVersions.value;
    return fromMap ?? [];
}

function aggregateStatusOf(b: BundleRow): BundleAggregateStatus {
    return bundleAggregateStatus(versionsOf(b.id), b.deletedAt);
}

const filteredBundles = computed(() => {
    const q = query.value?.trim().toLowerCase() ?? '';
    return bundles.value.filter((b) => {
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
const translatedCount = computed(() => bundles.value.filter((b) => i18nLocaleCount(b) > 0).length);

const liveCount = computed(
    () => bundles.value.filter((b) => aggregateStatusOf(b) === 'live').length,
);
const scheduledBundlesCount = computed(
    () => bundles.value.filter((b) => aggregateStatusOf(b) === 'scheduled').length,
);
const draftBundlesCount = computed(
    () => bundles.value.filter((b) => aggregateStatusOf(b) === 'draft').length,
);
const totalDraftVersions = computed(() => {
    let n = 0;
    for (const b of bundles.value) {
        for (const v of versionsOf(b.id)) {
            if (v.publishedAt === null) n += 1;
        }
    }
    return n;
});
const totalScheduledVersions = computed(() => {
    let n = 0;
    for (const b of bundles.value) {
        for (const v of versionsOf(b.id)) {
            if (bundleVersionStatus(v) === 'scheduled') n += 1;
        }
    }
    return n;
});

// ─── Inline creation panel (5 sections, at the top of the list) ───
const createOpen = ref(false);

/** For the bundle-key conflict check in the wizard. */
const existingBundleKeys = computed(() => bundles.value.map((b) => b.bundleKey));

const statusFilterOptions = computed<BundlesStatusFilterOption[]>(() => [
    { label: msg.value.filter.all, value: 'all' },
    { label: msg.value.filter.live, value: 'live' },
    { label: msg.value.filter.scheduled, value: 'scheduled' },
    { label: msg.value.filter.draft, value: 'draft' },
    { label: msg.value.filter.superseded, value: 'superseded' },
    { label: msg.value.filter.retired, value: 'retired' },
]);

function openCreatePanel(): void {
    createOpen.value = true;
}

async function onWizardCreated(bundle: BundleRow): Promise<void> {
    // Creation wrote the root + v1 draft in a single atom. Close the
    // panel, reload the list, then expand the freshly created bundle
    // so the user can keep working directly in the inline editor.
    createOpen.value = false;
    await reload();
    if (openKey.value !== bundle.id) {
        openKey.value = null;
        const next = bundles.value.find((b) => b.id === bundle.id);
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
    () => bundles.value.find((b) => b.id === openKey.value) ?? null,
);

/**
 * Reloads one bundle's versions into BOTH places the page reads them from.
 *
 * `versionsOf()` prefers the aggregate map — the KPIs and the status filter
 * are computed over it — and the detail pane reads `detailVersions`. A
 * mutation that refreshed only the pane left the totals on the pre-mutation
 * list until the whole page was reloaded.
 */
async function refreshVersions(bundleId: string): Promise<void> {
    const rows = await versionsOps.listForBundle(bundleId);
    detailVersions.value = rows;
    versionsByBundle.value = { ...versionsByBundle.value, [bundleId]: rows };
}

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
    await refreshVersions(bundle.id);
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
        const saved = await bundlesOps.update(detailBundle.value.id, {
            label: editForm.value.label,
            description: editForm.value.description || null,
            icon: editForm.value.icon || null,
            sortOrder: editForm.value.sortOrder,
            i18n: i18nDraft.value,
        });
        // The page owns `bundles`; the resource is stateless. Without this the
        // row kept its old label, and reopening the pane rebuilt the form from
        // it — the saved edit looked undone until a manual refresh.
        bundles.value = bundles.value.map((b) => (b.id === saved.id ? saved : b));
    } finally {
        editSubmitting.value = false;
    }
}

async function confirmDelete(bundle: BundleRow): Promise<void> {
    const ok = window.confirm(
        formatMessage(msg.value.page.confirmSoftDelete, { bundleKey: bundle.bundleKey }),
    );
    if (!ok) return;
    await bundlesOps.softDelete(bundle.id);
    if (openKey.value === bundle.id) openKey.value = null;
    bundles.value = bundles.value.filter((b) => b.id !== bundle.id);
    const { [bundle.id]: _gone, ...rest } = versionsByBundle.value;
    versionsByBundle.value = rest;
}

watch(
    () => bundles.value,
    (next) => {
        if (openKey.value && !next.some((b) => b.id === openKey.value)) {
            openKey.value = null;
        }
    },
);

// ─── Strict mode warnings ───
const lastWarnings = ref<StrictModeWarning[]>([]);

const strictWarningsText = computed(() =>
    formatMessage(msg.value.page.strictWarnings, { count: lastWarnings.value.length }),
);

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
        const result = await versionsOps.createDraft(bundleId, {
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
        await refreshVersions(bundleId);
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
        const result = await versionsOps.updateDraft(versionId, data);
        lastWarnings.value = result.warnings;
        await refreshVersions(bundleId);
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
    if (!versionsOps.discardDraft) {
        inlineEditorError.value =
            'Discard is not wired up in the wrapper — add the `discardDraft` prop.';
        return;
    }
    const ok = window.confirm(msg.value.page.confirmDiscardVersion);
    if (!ok) return;
    inlineEditorSaving.value = true;
    inlineEditorError.value = null;
    try {
        await versionsOps.discardDraft(versionId);
        // Remove from local list + re-select sensibly.
        await refreshVersions(bundleId);
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
        throw new Error('BundlesPage: publish submit without draft context');
    }
    return versionsOps.publish(publishDraft.value.id, opts);
}

async function onPublishSubmitted(result: BundleVersionMutationResult): Promise<void> {
    lastWarnings.value = result.warnings;
    publishDraft.value = null;
    if (detailBundle.value) {
        await refreshVersions(detailBundle.value.id);
    }
}

// A platform function, imported rather than injected: it is pure, it lives in
// `@saasicat/types`, and passing it in was the only way a page could reach it
// before the page was allowed to import anything itself.
const classifyDiff = computed(() => classifyBundleVersionDiff);
</script>

<style>
.sa-bundles {
    display: flex;
    flex-direction: column;
    gap: 14px;
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
/* The card's surface, open border, head padding, chevron and body now come
 * from `AdminAccordion` — twelve declarations that were this page's fourth
 * opinion on what an accordion looks like. What is left below is what the
 * BUNDLE row puts inside that header. */
.sa-bd-card__head {
    display: flex;
    gap: var(--sa-space-4);
    align-items: center;
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
    font-size: var(--sa-text-sm);
    font-family: var(--sa-font-mono, ui-monospace, monospace);
}
.sa-bd-card__name {
    font-size: var(--sa-text-md);
    font-weight: 600;
    margin-top: 2px;
}
.sa-bd-card__desc {
    font-size: var(--sa-text-sm);
    color: var(--sa-color-fg-muted);
}
.sa-bd-grid {
    display: grid;
    grid-template-columns: minmax(280px, 360px) 1fr;
    gap: 18px;
}
@media (max-width: 1023.98px) {
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
    font-size: var(--sa-text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--sa-color-fg-secondary);
    display: flex;
    justify-content: space-between;
}
.sa-bd-section-label--mt {
    margin-top: 10px;
}
.sa-bd-section-count {
    color: var(--sa-color-fg-subtle);
    font-weight: 600;
}
.sa-bundles__form {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.sa-bd-i18n-hint {
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-subtle);
}
.sa-bd-i18n-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--sa-color-border);
    border-radius: 8px;
    background: var(--sa-color-bg-surface);
}
.sa-bd-i18n-head {
    display: flex;
    gap: 8px;
    align-items: center;
}
.sa-bd-i18n-code {
    font-size: var(--sa-text-2xs);
    font-weight: 700;
    background: var(--sa-color-border-soft);
    padding: 2px 7px;
    border-radius: 5px;
}
.sa-bd-i18n-fallback {
    font-size: var(--sa-text-2xs);
    color: var(--sa-color-warning-fg);
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
    background: var(--sa-color-bg-surface);
    border: 1px solid var(--sa-color-border);
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
    font-size: var(--sa-text-xs);
    color: var(--sa-color-fg-muted);
    margin: 2px 0;
}
.sa-bd-version__feats {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.sa-bd-feat-chip {
    font-size: var(--sa-text-2xs);
    background: var(--sa-color-border-soft);
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
    color: var(--sa-color-fg-subtle);
    font-size: var(--sa-text-sm);
    border: 1px dashed var(--sa-color-border-strong);
    border-radius: 8px;
}
.sa-bundles__warnings-list {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: var(--sa-text-md);
}
</style>

<template>
    <PlatformBundlesPage
        :project-key="projectKey"
        :bundles="bundles"
        :loading="loading"
        :error="error"
        :active-locales="activeLocales"
        :plans="plans"
        :live-plan-versions="livePlanVersions"
        :versions-by-bundle="versionsByBundle"
        :feature-catalog="featureCatalog"
        :quota-catalog="quotaCatalog"
        :load="load"
        :create="create"
        :update="update"
        :soft-delete="softDelete"
        :load-versions="loadVersions"
        :create-draft="createDraft"
        :update-draft="updateDraft"
        :discard-draft="discardDraft"
        :publish="publish"
        :snapshot="snapshot"
        :classify-diff="classifyDiff"
    />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
    useBundles,
    useBundleVersions,
    useBundleVersionsMap,
    useCatalogEntries,
    useDiscovery,
    useLivePlanVersions,
    usePlans,
} from '@saasicat/ui-vue';
import PlatformBundlesPage from '@saasicat/ui-vue/pages/BundlesPage.vue';
import { classifyBundleVersionDiff } from '@saasicat/types';
import type {
    BundleVersionMutationResult,
    BundleVersionRow,
    CreateBundleVersionDraftData,
    UpdateBundleVersionDraftData,
} from '@saasicat/types';
import { platformHttp } from '../services/http';
import { useManifestStore } from '../stores/manifest';

const projectKey = 'notesapp';
const adminEndpoint = '/api/v1/admin';
const http = platformHttp;

// Locale pool from the AdminManifest (`marketing.availableLocales`);
// PlatformBundlesPage shows the non-default locales in the translation editor.
const manifestStore = useManifestStore();
const activeLocales = computed(() => manifestStore.manifest?.project?.availableLocales ?? ['de']);

const { bundles, loading, error, load, create, update, softDelete } = useBundles({
    adminEndpoint,
    projectKey,
    http,
});

// Plan roots for the Plan↔Bundle compat picker in the inline editor.
const { plans, load: loadPlans } = usePlans({ adminEndpoint, projectKey, http });

// Live PlanVersions for the overlap calculation in the compat picker.
const { livePlanVersions } = useLivePlanVersions({ adminEndpoint, plans, http });

// Version map per bundle for KPI/status filters across all bundles.
const { versionsByBundle, refreshOne: refreshVersionsForBundle } = useBundleVersionsMap({
    adminEndpoint,
    bundles,
    http,
});

const versionComposables = new Map<string, ReturnType<typeof useBundleVersions>>();

function getVersionComposable(bundleId: string): ReturnType<typeof useBundleVersions> {
    let comp = versionComposables.get(bundleId);
    if (!comp) {
        comp = useBundleVersions({ adminEndpoint, bundleId, http });
        versionComposables.set(bundleId, comp);
    }
    return comp;
}

function anyVersionComposable(): ReturnType<typeof useBundleVersions> {
    return (
        versionComposables.values().next().value ??
        useBundleVersions({ adminEndpoint, bundleId: 'noop', http })
    );
}

async function loadVersions(bundleId: string): Promise<BundleVersionRow[]> {
    const comp = getVersionComposable(bundleId);
    await comp.load();
    await refreshVersionsForBundle(bundleId);
    return comp.versions.value;
}

async function createDraft(
    bundleId: string,
    data: Omit<CreateBundleVersionDraftData, 'bundleId'>,
): Promise<BundleVersionMutationResult> {
    return getVersionComposable(bundleId).createDraft(data);
}

async function updateDraft(
    versionId: string,
    data: UpdateBundleVersionDraftData,
): Promise<BundleVersionMutationResult> {
    return anyVersionComposable().updateDraft(versionId, data);
}

async function publish(
    versionId: string,
    opts: { forceRegressive?: boolean; validFrom?: string | null; validUntil?: string | null },
): Promise<BundleVersionMutationResult> {
    return anyVersionComposable().publish(versionId, opts);
}

async function discardDraft(versionId: string): Promise<void> {
    return anyVersionComposable().discardDraft(versionId);
}

const { snapshot, load: loadSnapshot } = useDiscovery({
    endpoint: `${adminEndpoint}/discovery`,
    http,
});

// Feature/quota catalog (incl. i18n) for translated labels in the creation +
// detail views. Translations are maintained on the discovery review page.
const {
    features: featureCatalog,
    quotas: quotaCatalog,
    load: loadCatalogEntries,
} = useCatalogEntries({ adminEndpoint, projectKey, http });

const classifyDiff = ref(classifyBundleVersionDiff);

onMounted(async () => {
    await Promise.all([load(), loadSnapshot(), loadPlans(), loadCatalogEntries()]);
});
</script>

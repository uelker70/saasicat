<template>
    <PlatformBusinessTypesPage
        :project-key="projectKey"
        :business-types="businessTypes"
        :loading="loading"
        :error="error"
        :load="load"
        :create="create"
        :update="update"
        :soft-delete="softDelete"
        :load-versions="loadVersions"
        :create-draft="createDraft"
        :update-draft="updateDraft"
        :publish="publish"
        :available-bundles="availableBundles"
        :classify-diff="classifyDiff"
    />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
    useBundles,
    useBundleVersionsMap,
    useBusinessTypes,
    useBusinessTypeVersions,
} from '@saasicat/ui-vue';
import PlatformBusinessTypesPage from '@saasicat/ui-vue/pages/BusinessTypesPage.vue';
import { classifyBusinessTypeVersionDiff } from '@saasicat/types';
import type {
    BundleVersionRow,
    BusinessTypeVersionMutationResult,
    BusinessTypeVersionRow,
    CreateBusinessTypeVersionDraftData,
    UpdateBusinessTypeVersionDraftData,
} from '@saasicat/types';
import { platformHttp } from '../services/http';

const projectKey = 'notesapp';
const adminEndpoint = '/api/v1/admin';
const http = platformHttp;

const { businessTypes, loading, error, load, create, update, softDelete } = useBusinessTypes({
    adminEndpoint,
    projectKey,
    http,
});

const versionComposables = new Map<string, ReturnType<typeof useBusinessTypeVersions>>();

function getVersionComposable(businessTypeId: string): ReturnType<typeof useBusinessTypeVersions> {
    let comp = versionComposables.get(businessTypeId);
    if (!comp) {
        comp = useBusinessTypeVersions({ adminEndpoint, businessTypeId, http });
        versionComposables.set(businessTypeId, comp);
    }
    return comp;
}

function anyVersionComposable(): ReturnType<typeof useBusinessTypeVersions> {
    return (
        versionComposables.values().next().value ??
        useBusinessTypeVersions({ adminEndpoint, businessTypeId: 'noop', http })
    );
}

async function loadVersions(businessTypeId: string): Promise<BusinessTypeVersionRow[]> {
    const comp = getVersionComposable(businessTypeId);
    await comp.load();
    return comp.versions.value;
}

async function createDraft(
    businessTypeId: string,
    data: Omit<CreateBusinessTypeVersionDraftData, 'businessTypeId'>,
): Promise<BusinessTypeVersionMutationResult> {
    return getVersionComposable(businessTypeId).createDraft(data);
}

async function updateDraft(
    versionId: string,
    data: UpdateBusinessTypeVersionDraftData,
): Promise<BusinessTypeVersionMutationResult> {
    return anyVersionComposable().updateDraft(versionId, data);
}

async function publish(
    versionId: string,
    opts: { forceRegressive?: boolean },
): Promise<BusinessTypeVersionMutationResult> {
    return anyVersionComposable().publish(versionId, opts);
}

// Published BundleVersions across all bundles — the pool a BusinessType
// version composes from. useBundleVersionsMap refreshes when `bundles` loads.
const { bundles, load: loadBundles } = useBundles({ adminEndpoint, projectKey, http });
const { versionsByBundle } = useBundleVersionsMap({ adminEndpoint, bundles, http });
const availableBundles = computed<BundleVersionRow[]>(() =>
    Object.values(versionsByBundle.value)
        .flat()
        .filter((v) => v.publishedAt !== null),
);

const classifyDiff = ref(classifyBusinessTypeVersionDiff);

onMounted(async () => {
    await Promise.all([load(), loadBundles()]);
});
</script>

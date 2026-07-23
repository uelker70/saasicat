<template>
    <PlatformDiscoveryPage
        :snapshot="snapshot"
        :capabilities="capabilities"
        :features="features"
        :quotas="quotas"
        :loading="loading"
        :error="error"
        :active-locales="activeLocales"
        :run-discovery="runDiscovery"
        :review-feature="reviewFeature"
        :review-quota="reviewQuota"
        :set-feature-i18n="setFeatureI18n"
        :set-quota-i18n="setQuotaI18n"
        :set-feature-base="setFeatureBase"
        :set-quota-base="setQuotaBase"
    />
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useCatalogEntries, useDiscovery } from '@saasicat/ui-vue';
import PlatformDiscoveryPage from '@saasicat/ui-vue/pages/DiscoveryPage.vue';
import { platformHttp } from '../services/http';
import { useManifestStore } from '../stores/manifest';

const http = platformHttp;
const adminEndpoint = '/api/v1/admin';
const projectKey = 'notesapp';

const {
    snapshot,
    loading: snapLoading,
    error: snapError,
    reload,
    rescan,
} = useDiscovery({ endpoint: `${adminEndpoint}/discovery`, http });

const {
    capabilities,
    features,
    quotas,
    loading: entriesLoading,
    error: entriesError,
    load,
    reviewFeature,
    reviewQuota,
    setFeatureI18n,
    setQuotaI18n,
    setFeatureBase,
    setQuotaBase,
    syncDiscovery,
} = useCatalogEntries({ adminEndpoint, projectKey, http });

const manifestStore = useManifestStore();
const activeLocales = computed(() => manifestStore.manifest?.project?.availableLocales ?? ['de']);

const loading = computed(() => snapLoading.value || entriesLoading.value);
const error = computed(() => snapError.value ?? entriesError.value);

async function runDiscovery(): Promise<void> {
    await rescan();
    if (snapshot.value) {
        await syncDiscovery(snapshot.value);
    }
}

onMounted(() => {
    void load();
    void reload();
});
</script>

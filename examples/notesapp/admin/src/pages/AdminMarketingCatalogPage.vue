<template>
    <PlatformMarketingCatalogPage
        :admin-endpoint="adminEndpoint"
        :project-key="projectKey"
        :http="http"
        :available-locales="availableLocales"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import PlatformMarketingCatalogPage from '@saasicat/ui-vue/pages/MarketingCatalogPage.vue';
import { platformHttp } from '../services/http';
import { useManifestStore } from '../stores/manifest';

const projectKey = 'notesapp';
const adminEndpoint = '/api/v1/admin';
const http = platformHttp;

const manifestStore = useManifestStore();
const availableLocales = computed(
    () => manifestStore.manifest?.project?.availableLocales ?? ['de'],
);
</script>

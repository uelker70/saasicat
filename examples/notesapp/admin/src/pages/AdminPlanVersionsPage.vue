<template>
    <PlatformPlanVersionsPage :data="data" :loading="loading" />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { usePlans, usePlanVersions } from '@saasicat/ui-vue';
import type { RawCatalogData } from '@saasicat/ui-vue';
import PlatformPlanVersionsPage from '@saasicat/ui-vue/pages/PlanVersionsPage.vue';
import type { PlanVersionRow } from '@saasicat/types';
import { platformHttp } from '../services/http';

const projectKey = 'notesapp';
const adminEndpoint = '/api/v1/admin';
const http = platformHttp;

// The catalog exposes versions only per plan (`/catalog/plans/:id/versions`);
// PlanVersionsPage renders synthetic snapshots from the flat list of every
// plan's versions, so the wrapper fans out over the plan roots and merges.
const { plans, load: loadPlans } = usePlans({ adminEndpoint, projectKey, http });
const planVersions = ref<PlanVersionRow[]>([]);
const loading = ref(false);

const data = computed<RawCatalogData>(() => ({ planVersions: planVersions.value }));

async function loadAll(): Promise<void> {
    loading.value = true;
    try {
        await loadPlans();
        const perPlan = await Promise.all(
            plans.value.map(async (plan) => {
                const { versions, load } = usePlanVersions({
                    adminEndpoint,
                    planId: plan.id,
                    http,
                });
                await load();
                return versions.value;
            }),
        );
        planVersions.value = perPlan.flat();
    } finally {
        loading.value = false;
    }
}

onMounted(() => {
    void loadAll();
});
</script>
